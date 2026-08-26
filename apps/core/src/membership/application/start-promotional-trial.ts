import { calculateCalendarMonthEnd } from "../domain/billing-calendar";
import { createMembershipRepository } from "../infrastructure/d1/membership-repository";
import {
  claimIntroductoryTrialRedemption,
  hasIntroductoryRedemption,
} from "../../promotions/application/grant-introductory-trial";
import { requestHash } from "../../idempotency";

export type StartPromotionalTrialCommand = {
  customerId: string;
  idempotencyKey: string;
  requestId: string;
};

export type SubscriptionSummary = {
  subscriptionId: string;
  state: "PENDING" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED";
  cancelAtPeriodEnd: boolean;
  scheduledCancellationAt: string | null;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  promotionRedemptionId?: string;
  version: number;
};

const TRIAL_SCOPE = "membership.startTrial";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Start the introductory calendar-month trial. Promotions owns authority
 * (one atomically consumed redemption per customer); Membership calculates the
 * exact trial end in the market business timezone; grant/redemption,
 * subscription, event, and idempotency completion commit in one batch.
 */
export async function startPromotionalTrial(
  database: D1Database,
  command: StartPromotionalTrialCommand,
): Promise<
  { ok: true; value: SubscriptionSummary; requestId: string } | ReturnType<typeof failure>
> {
  const repository = createMembershipRepository(database);
  const hash = await requestHash({ customerId: command.customerId });

  const existingRecord = await database
    .prepare(
      "SELECT request_hash, status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(TRIAL_SCOPE, command.idempotencyKey)
    .first<{ request_hash: string; status: string; result_reference: string | null }>();
  if (existingRecord) {
    if (existingRecord.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        command.requestId,
      );
    if (existingRecord.status === "SUCCEEDED" && existingRecord.result_reference) {
      const subscription = await repository.findSubscriptionById(existingRecord.result_reference);
      if (subscription)
        return {
          ok: true,
          value: summaryFrom(subscription, existingRecord.result_reference),
          requestId: command.requestId,
        };
    }
    return failure(
      "CONFLICT",
      existingRecord.status === "FAILED"
        ? "The original trial command failed; retry with a new idempotency key"
        : "The original trial command is still processing",
      command.requestId,
    );
  }

  if (await hasIntroductoryRedemption(database, command.customerId))
    return failure(
      "PROMOTION_INELIGIBLE",
      "The introductory trial was already used",
      command.requestId,
    );

  const openSubscription = await repository.findOpenSubscriptionByCustomer(command.customerId);
  if (openSubscription)
    return failure(
      "OPEN_SUBSCRIPTION_EXISTS",
      "An open membership subscription already exists for this customer",
      command.requestId,
    );

  const timeZone = await repository.marketTimezone();
  const now = Date.now();
  const trialStartsAtIso = new Date(now).toISOString();
  let trialEndsAtIso: string;
  try {
    trialEndsAtIso = calculateCalendarMonthEnd(trialStartsAtIso, timeZone);
  } catch (error) {
    return failure(
      "CONFIGURATION_ERROR",
      `Market timezone is invalid: ${(error as Error).message}`,
      command.requestId,
    );
  }
  const trialEndsAtMs = Date.parse(trialEndsAtIso);

  // The canonical PHP 299/calendar-month paid offer this trial precedes.
  const offer = await database
    .prepare(
      "SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY' AND status='active'",
    )
    .first<{ id: string }>();
  if (!offer)
    return failure(
      "CONFIGURATION_ERROR",
      "Paid membership offer is not configured",
      command.requestId,
    );

  const subscriptionId = crypto.randomUUID();
  const redemptionId = crypto.randomUUID();
  const now2 = Date.now();
  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'subscription', 'PROCESSING', ?, ?)",
        )
        .bind(TRIAL_SCOPE, command.idempotencyKey, hash, now2, now2),
      claimIntroductoryTrialRedemption(database, {
        redemptionId,
        customerId: command.customerId,
        subjectType: "subscription",
        subjectId: subscriptionId,
        now: now2,
      }),
      database
        .prepare(
          "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, cancel_at_period_end, version, created_at, updated_at) VALUES (?, ?, ?, 'TRIALING', ?, ?, 0, 1, ?, ?)",
        )
        .bind(subscriptionId, command.customerId, offer.id, now, trialEndsAtMs, now2, now2),
      database
        .prepare(
          "INSERT INTO subscription_event (id, subscription_id, event_type, promotion_redemption_id, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, 'TRIAL_STARTED', ?, 'CUSTOMER', ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          subscriptionId,
          redemptionId,
          JSON.stringify({ timeZone, trialEndsAt: trialEndsAtIso }),
          now2,
          now2,
        ),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(subscriptionId, now2, TRIAL_SCOPE, command.idempotencyKey),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("promotion_redemption")) {
      await database
        .prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now2, TRIAL_SCOPE, command.idempotencyKey)
        .run();
      return failure(
        "PROMOTION_INELIGIBLE",
        "The introductory trial was already used",
        command.requestId,
      );
    }
    if (message.includes("subscription_one_open_per_customer_idx")) {
      await database
        .prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(now2, TRIAL_SCOPE, command.idempotencyKey)
        .run();
      return failure(
        "OPEN_SUBSCRIPTION_EXISTS",
        "An open membership subscription already exists",
        command.requestId,
      );
    }
    throw error;
  }

  const created = await repository.findSubscriptionById(subscriptionId);
  if (!created) throw new Error("TRIAL_SUBSCRIPTION_LOST");
  return {
    ok: true,
    value: summaryFrom(created, subscriptionId),
    requestId: command.requestId,
  };
}

function summaryFrom(
  subscription: {
    id: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    scheduledCancellationAt: number | null;
    trialEndsAt: number | null;
    startsAt: number;
    version: number;
  },
  _subscriptionId: string,
): SubscriptionSummary {
  void _subscriptionId;
  return {
    subscriptionId: subscription.id,
    state: toState(subscription.status),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    scheduledCancellationAt: toIso(subscription.scheduledCancellationAt),
    trialStartsAt: toIso(subscription.startsAt),
    trialEndsAt: toIso(subscription.trialEndsAt),
    version: subscription.version,
  };
}

function toState(status: string): SubscriptionSummary["state"] {
  switch (status) {
    case "PENDING":
    case "TRIALING":
    case "ACTIVE":
    case "PAST_DUE":
    case "PAUSED":
    case "CANCELED":
    case "EXPIRED":
      return status;
    default:
      return "PENDING";
  }
}
