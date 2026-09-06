import type {
  AuthenticatedRequest,
  MembershipPriceConfigurationView,
  RpcResult,
  UpdateMembershipPriceConfigurationRequest,
} from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { claimCommandIdempotency } from "../../idempotency";
import {
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";

type MembershipPriceRow = {
  id: string;
  offer_id: string;
  amount_minor: number;
  currency: string;
  effective_from: number;
  effective_to: number | null;
  version: number;
};

const failure = <T>(
  code: Parameters<typeof failCode>[0],
  message: string,
  requestId: string,
): RpcResult<T> => ({ ok: false, error: { code, message, requestId } });

function failCode(code: import("@freshmarkets/contracts").AppErrorCode) {
  return code;
}

function membershipView(row: MembershipPriceRow): MembershipPriceConfigurationView {
  return {
    priceVersionId: row.id,
    offerId: row.offer_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    effectiveFrom: new Date(row.effective_from).toISOString(),
    effectiveTo: row.effective_to === null ? null : new Date(row.effective_to).toISOString(),
    version: row.version,
  };
}

async function activeMembershipPrice(database: D1Database, at: number) {
  return database
    .prepare(
      `SELECT id, offer_id, amount_minor, currency, effective_from, effective_to, version
       FROM membership_price_version
       WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, version DESC LIMIT 1`,
    )
    .bind(at, at)
    .first<MembershipPriceRow>();
}

async function latestMembershipPrice(database: D1Database) {
  return database
    .prepare(
      `SELECT id, offer_id, amount_minor, currency, effective_from, effective_to, version
       FROM membership_price_version ORDER BY version DESC LIMIT 1`,
    )
    .first<MembershipPriceRow>();
}

async function membershipPriceById(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT id, offer_id, amount_minor, currency, effective_from, effective_to, version
       FROM membership_price_version WHERE id = ?`,
    )
    .bind(id)
    .first<MembershipPriceRow>();
}

async function failIdempotency(database: D1Database, scope: string, key: string) {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

function parseEffectiveFrom(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

export async function getMembershipPriceConfiguration(
  deps: FinanceAdministrationDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<MembershipPriceConfigurationView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.read");
  if (!access.ok) return access;
  const row = await activeMembershipPrice(deps.db, Date.now());
  return row
    ? { ok: true, value: membershipView(row), requestId: request.requestId }
    : failure("CONFIGURATION_ERROR", "Membership price is unavailable", request.requestId);
}

export async function updateMembershipPriceConfiguration(
  deps: FinanceAdministrationDeps,
  request: UpdateMembershipPriceConfigurationRequest,
): Promise<RpcResult<MembershipPriceConfigurationView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.manage");
  if (!access.ok) return access;
  const effectiveFrom = parseEffectiveFrom(request.effectiveFrom);
  if (
    !Number.isSafeInteger(request.amountMinor) ||
    request.amountMinor <= 0 ||
    !validCurrency(request.currency) ||
    effectiveFrom === null ||
    request.reason.trim().length === 0
  ) {
    return failure(
      "VALIDATION_FAILED",
      "Membership price configuration is invalid",
      request.requestId,
    );
  }

  const scope = "admin.membership-price.update";
  const claim = await claimCommandIdempotency(deps.db, Date.now, scope, request.idempotencyKey, {
    expectedVersion: request.expectedVersion,
    amountMinor: request.amountMinor,
    currency: request.currency,
    effectiveFrom: request.effectiveFrom,
    reason: request.reason.trim(),
  });
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key was reused", request.requestId);
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const replay = await membershipPriceById(deps.db, claim.existing.resultReference);
      if (replay) return { ok: true, value: membershipView(replay), requestId: request.requestId };
    }
    return failure("CONFLICT", "Membership price update is processing", request.requestId);
  }

  const previous = await latestMembershipPrice(deps.db);
  if (
    !previous ||
    previous.version !== request.expectedVersion ||
    effectiveFrom <= previous.effective_from
  ) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure(
      "STALE_VERSION",
      "Membership price changed; refresh before retrying",
      request.requestId,
    );
  }
  const id = crypto.randomUUID();
  const version = previous.version + 1;
  const now = Date.now();
  try {
    const results = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE membership_price_version SET effective_to=? WHERE id=? AND version=? AND effective_to IS NULL",
        )
        .bind(effectiveFrom, previous.id, request.expectedVersion),
      deps.db
        .prepare(
          `INSERT INTO membership_price_version
             (id, offer_id, amount_minor, currency, effective_from, effective_to,
              version, created_by_staff_id, created_at)
           SELECT ?, offer_id, ?, ?, ?, NULL, ?, ?, ?
           FROM membership_price_version
           WHERE id=? AND version=? AND effective_to=?`,
        )
        .bind(
          id,
          request.amountMinor,
          request.currency,
          effectiveFrom,
          version,
          access.value.staffId,
          now,
          previous.id,
          request.expectedVersion,
          effectiveFrom,
        ),
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "MEMBERSHIP_PRICE_CONFIGURATION.UPDATED",
          resourceType: "membership_price_version",
          resourceId: id,
          before: membershipView(previous),
          after: { amountMinor: request.amountMinor, currency: request.currency, version },
          reason: request.reason.trim(),
          correlationId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          occurredAt: now,
        },
        { clause: "EXISTS (SELECT 1 FROM membership_price_version WHERE id=?)", binds: [id] },
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING'
             AND EXISTS (SELECT 1 FROM membership_price_version WHERE id=?)`,
        )
        .bind(id, now, scope, request.idempotencyKey, id),
    ]);
    if ((results[1]?.meta?.changes ?? 0) !== 1) throw new Error("stale membership price");
  } catch {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure(
      "STALE_VERSION",
      "Membership price changed; refresh before retrying",
      request.requestId,
    );
  }
  const created = await membershipPriceById(deps.db, id);
  return created
    ? { ok: true, value: membershipView(created), requestId: request.requestId }
    : failure("INTERNAL_ERROR", "Membership price could not be read back", request.requestId);
}
