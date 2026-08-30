import type {
  AppErrorCode,
  MembershipExperienceView,
  MembershipOfferView,
  SubscriptionSummary,
} from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import {
  createMembershipRepository,
  type SubscriptionRow,
} from "../infrastructure/d1/membership-repository";

type CustomerRequest = { customerId: string; requestId: string };
type BeginPaidEnrollmentCommand = CustomerRequest & { offerId: string; idempotencyKey: string };

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function subscriptionSummary(row: SubscriptionRow): SubscriptionSummary {
  return {
    subscriptionId: row.id,
    state: row.status as SubscriptionSummary["state"],
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    scheduledCancellationAt: toIso(row.scheduledCancellationAt),
    trialStartsAt: row.trialEndsAt === null ? null : toIso(row.startsAt),
    trialEndsAt: toIso(row.trialEndsAt),
    version: row.version,
  };
}

async function activeOffer(database: D1Database): Promise<MembershipOfferView | null> {
  const row = await database
    .prepare(
      "SELECT id, code, name, fee_minor, currency, billing_interval FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY' AND status='active' AND is_default=1 LIMIT 1",
    )
    .first<{
      id: string;
      code: string;
      name: string;
      fee_minor: number;
      currency: string;
      billing_interval: string;
    }>();
  if (!row || row.billing_interval !== "CALENDAR_MONTH") return null;
  return {
    offerId: row.id,
    code: row.code,
    name: row.name,
    amountMinor: row.fee_minor,
    currency: row.currency,
    billingInterval: "CALENDAR_MONTH",
  };
}

export async function getMembershipOffer(database: D1Database, request: CustomerRequest) {
  const offer = await activeOffer(database);
  return offer
    ? ({ ok: true as const, value: offer, requestId: request.requestId } as const)
    : failure("CONFIGURATION_ERROR", "Paid membership offer is unavailable", request.requestId);
}

export async function getSubscriptionSummaryForCustomer(
  database: D1Database,
  request: CustomerRequest,
) {
  const row = await createMembershipRepository(database).findAnySubscriptionByCustomer(
    request.customerId,
  );
  return row
    ? ({
        ok: true as const,
        value: subscriptionSummary(row),
        requestId: request.requestId,
      } as const)
    : failure("NOT_FOUND", "No membership subscription exists", request.requestId);
}

export async function findSubscriptionIdForCustomer(
  database: D1Database,
  customerId: string,
): Promise<string | null> {
  const row = await database
    .prepare("SELECT id FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1")
    .bind(customerId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function availability(available: boolean, disabledReason: string | null = null) {
  return { available, disabledReason: available ? null : disabledReason };
}

export async function getMembershipExperience(database: D1Database, request: CustomerRequest) {
  const offer = await activeOffer(database);
  if (!offer)
    return failure(
      "CONFIGURATION_ERROR",
      "Paid membership offer is unavailable",
      request.requestId,
    );

  const repository = createMembershipRepository(database);
  const subscription = await repository.findAnySubscriptionByCustomer(request.customerId);
  const redemption = await database
    .prepare(
      "SELECT 1 AS found FROM promotion_redemption WHERE customer_id=? AND benefit_code='INTRO_TRIAL' LIMIT 1",
    )
    .bind(request.customerId)
    .first<{ found: number }>();
  const authorization = await database
    .prepare(
      "SELECT status, recurring_capable FROM payment_authorization WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(request.customerId)
    .first<{ status: string; recurring_capable: number }>();

  const authorizationReady =
    authorization?.status === "ACTIVE" && authorization.recurring_capable === 1;
  const authorizationStatus = authorizationReady
    ? "READY"
    : authorization?.status === "PENDING"
      ? "PENDING"
      : "REQUIRED";
  const isOpen =
    subscription !== null &&
    ["PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"].includes(subscription.status);
  const trialStatus = redemption
    ? "REDEEMED"
    : isOpen
      ? "OPEN_SUBSCRIPTION"
      : authorizationReady
        ? "AVAILABLE"
        : "AUTHORIZATION_REQUIRED";
  const state = subscription?.status ?? null;
  const terminalOrMissing = state === null || state === "CANCELED" || state === "EXPIRED";

  const value: MembershipExperienceView = {
    offer,
    subscription: subscription ? subscriptionSummary(subscription) : null,
    introductoryTrial: {
      status: trialStatus,
      eligible: trialStatus === "AVAILABLE",
      duration: "CALENDAR_MONTH",
    },
    recurringAuthorization: { status: authorizationStatus, ready: authorizationReady },
    actions: {
      startTrial: availability(
        trialStatus === "AVAILABLE",
        redemption
          ? "INTRODUCTORY_TRIAL_ALREADY_USED"
          : isOpen
            ? "OPEN_SUBSCRIPTION_EXISTS"
            : "RECURRING_AUTHORIZATION_REQUIRED",
      ),
      beginPaidEnrollment: availability(
        terminalOrMissing,
        isOpen ? "OPEN_SUBSCRIPTION_EXISTS" : "MEMBERSHIP_UNAVAILABLE",
      ),
      pause: availability(
        state === "ACTIVE" || state === "PAST_DUE",
        state === null ? "SUBSCRIPTION_REQUIRED" : "SUBSCRIPTION_NOT_PAUSABLE",
      ),
      resume: availability(
        state === "PAUSED",
        state === null ? "SUBSCRIPTION_REQUIRED" : "SUBSCRIPTION_NOT_PAUSED",
      ),
      cancelImmediately: availability(
        state !== null && ["PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"].includes(state),
        state === null ? "SUBSCRIPTION_REQUIRED" : "SUBSCRIPTION_NOT_CANCELABLE",
      ),
      cancelAtPeriodEnd: availability(
        state === "TRIALING" || state === "ACTIVE",
        state === null ? "SUBSCRIPTION_REQUIRED" : "NO_ENTITLED_PERIOD_TO_FINISH",
      ),
    },
  };
  return { ok: true as const, value, requestId: request.requestId };
}

export async function beginPaidEnrollment(
  database: D1Database,
  command: BeginPaidEnrollmentCommand,
) {
  const scope = "membership.beginPaidEnrollment";
  const hash = await requestHash({ customerId: command.customerId, offerId: command.offerId });
  const repository = createMembershipRepository(database);
  const replay = await database
    .prepare(
      "SELECT request_hash, status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(scope, command.idempotencyKey)
    .first<{ request_hash: string; status: string; result_reference: string | null }>();
  if (replay) {
    if (replay.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (replay.status === "SUCCEEDED" && replay.result_reference) {
      const row = await repository.findSubscriptionById(replay.result_reference);
      if (row)
        return { ok: true as const, value: subscriptionSummary(row), requestId: command.requestId };
    }
    return failure("CONFLICT", "The original enrollment is still processing", command.requestId);
  }

  const offer = await activeOffer(database);
  if (!offer || offer.offerId !== command.offerId)
    return failure("NOT_FOUND", "Membership offer is unavailable", command.requestId);
  if (await repository.findOpenSubscriptionByCustomer(command.customerId))
    return failure(
      "OPEN_SUBSCRIPTION_EXISTS",
      "An open membership subscription already exists",
      command.requestId,
    );

  const now = Date.now();
  const subscriptionId = crypto.randomUUID();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES (?, ?, ?, 'subscription', ?, 'PROCESSING', ?, ?)",
        )
        .bind(scope, command.idempotencyKey, hash, subscriptionId, now, now),
      database
        .prepare(
          "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, cancel_at_period_end, version, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', ?, 0, 1, ?, ?)",
        )
        .bind(subscriptionId, command.customerId, offer.offerId, now, now, now),
      database
        .prepare(
          "INSERT INTO subscription_event (id, subscription_id, event_type, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, 'ENROLLMENT_BEGUN', 'CUSTOMER', '{}', ?, ?)",
        )
        .bind(crypto.randomUUID(), subscriptionId, now, now),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now, scope, command.idempotencyKey),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("subscription_one_open_per_customer_idx"))
      return failure(
        "OPEN_SUBSCRIPTION_EXISTS",
        "An open membership subscription already exists",
        command.requestId,
      );
    if (message.includes("idempotency_records"))
      return failure("CONFLICT", "The original enrollment is still processing", command.requestId);
    throw error;
  }
  const row = await repository.findSubscriptionById(subscriptionId);
  if (!row) throw new Error("PENDING_SUBSCRIPTION_LOST");
  return { ok: true as const, value: subscriptionSummary(row), requestId: command.requestId };
}
