import type { AdminRefundView, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { replaceRejectedCancellationRefundStatements } from "../../orders/application/replace-rejected-cancellation-refund";
import { refundBudgetStatement } from "../infrastructure/d1/payment-repository";
import { rejectedRefundRetryEligibility } from "../infrastructure/d1/refund-retry-eligibility";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { submitClaimedRefund } from "./request-refund";

const SCOPE = "admin.payments.refund-retry";
const authority = `EXISTS (SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
 JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='refunds.manage'
 JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global'
 WHERE staff.auth_user_id=? AND staff.status='active')`;
const receipt = z.object({
  refundId: z.string(),
  paymentIntentId: z.string(),
  amountMinor: z.number().int().safe().positive(),
  currency: z.string(),
  status: z.literal("REQUESTED"),
  reason: z.string(),
  createdAt: z.string(),
});
type Command = {
  refundId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  actorAuthUserId: string;
  requestId: string;
};

/** Preserve the rejected attempt and durably admit one replacement before calling the provider. */
export async function retryStaffRefund(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: Command,
): Promise<RpcResult<AdminRefundView>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<AdminRefundView> => ({
    ok: false,
    error: { code, message, requestId: command.requestId },
  });
  const reason = command.reason.trim();
  if (
    !reason ||
    reason.length > 500 ||
    !command.refundId.trim() ||
    command.refundId.length > 200 ||
    !command.idempotencyKey.trim() ||
    command.idempotencyKey.length > 200 ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1
  )
    return fail(
      "VALIDATION_FAILED",
      "A current refund version, stable key and reason are required",
    );
  if (
    !(await database.prepare(`SELECT 1 WHERE ${authority}`).bind(command.actorAuthUserId).first())
  )
    return fail("FORBIDDEN", "Global refund permission is required");
  const hash = await requestHash({
    refundId: command.refundId,
    expectedVersion: command.expectedVersion,
    reason,
    actorAuthUserId: command.actorAuthUserId,
  });
  async function replay(): Promise<RpcResult<AdminRefundView> | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to another refund retry");
    return saved.status === "SUCCEEDED"
      ? {
          ok: true,
          value: receipt.parse(JSON.parse(saved.resultReference ?? "null")),
          requestId: command.requestId,
        }
      : null;
  }
  const prior = await replay();
  if (prior) return prior;
  const rejected = await database
    .prepare(`SELECT refund.payment_intent_id,refund.amount_minor,refund.currency
    FROM payment_refund refund WHERE refund.id=? AND refund.version=? AND ${rejectedRefundRetryEligibility}`)
    .bind(command.refundId, command.expectedVersion)
    .first<{ payment_intent_id: string; amount_minor: number; currency: string }>();
  if (!rejected)
    return fail(
      "CONFLICT",
      "Only a current, definitively rejected refund with available balance can be retried; refresh the payment",
    );
  const attempt = await database
    .prepare(`SELECT id,provider,provider_reference FROM payment_attempt
    WHERE payment_intent_id=? AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED') ORDER BY created_at DESC,id LIMIT 1`)
    .bind(rejected.payment_intent_id)
    .first<{ id: string; provider: string; provider_reference: string | null }>();
  if (!attempt?.provider_reference)
    return fail("CONFIGURATION_ERROR", "Captured provider payment evidence is missing");
  let provider;
  try {
    provider = registry.require(attempt.provider);
  } catch {
    return fail("CONFIGURATION_ERROR", "The captured payment provider is unavailable");
  }
  const now = Date.now(),
    refundId = crypto.randomUUID();
  const effectKey = `refund-retry:${refundId}`;
  const accepted: AdminRefundView = {
    refundId,
    paymentIntentId: rejected.payment_intent_id,
    amountMinor: rejected.amount_minor,
    currency: rejected.currency,
    status: "REQUESTED",
    reason,
    createdAt: new Date(now).toISOString(),
  };
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT ${authority}`)
        .bind(command.actorAuthUserId),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
        VALUES (?,?,?,'PROCESSING','refund_retry',?,?) ON CONFLICT(scope,idempotency_key) DO NOTHING`)
        .bind(SCOPE, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(`UPDATE payment_refund AS refund SET version=version+1
        WHERE refund.id=? AND refund.version=? AND ${rejectedRefundRetryEligibility}
        AND EXISTS (SELECT 1 FROM payment_attempt attempt WHERE attempt.id=? AND attempt.payment_intent_id=refund.payment_intent_id
          AND attempt.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND attempt.provider=? AND attempt.provider_reference=?)`)
        .bind(
          command.refundId,
          command.expectedVersion,
          attempt.id,
          attempt.provider,
          attempt.provider_reference,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      refundBudgetStatement(database, {
        refundId,
        intentId: rejected.payment_intent_id,
        amountMinor: rejected.amount_minor,
        reason,
        idempotencyKey: effectKey,
        replacesRejectedRefundId: command.refundId,
        now,
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ...replaceRejectedCancellationRefundStatements(database, {
        rejectedRefundId: command.refundId,
        replacementRefundId: refundId,
        now,
      }),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.REFUND_RETRIED",
        resourceType: "payment_refund",
        resourceId: command.refundId,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        details: { replacementRefundId: refundId, amountMinor: rejected.amount_minor },
        occurredAt: now,
      }),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event
        WHERE aggregate_id=? AND action='PAYMENT.REFUND_RETRIED' AND idempotency_key=?)`)
        .bind(command.refundId, command.idempotencyKey),
      database
        .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
        WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
        .bind(JSON.stringify(accepted), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    ]);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (error instanceof Error && /constraint failed/i.test(error.message))
      return fail(
        "CONFLICT",
        "Refund, cancellation, balance or authority changed; refresh before retrying",
      );
    throw error;
  }
  await submitClaimedRefund(database, provider, {
    refundId,
    requestedVersion: 1,
    paymentIntentId: rejected.payment_intent_id,
    currency: rejected.currency,
    providerCode: attempt.provider,
    providerReference: attempt.provider_reference,
    amountMinor: rejected.amount_minor,
    idempotencyKey: effectKey,
    requestId: command.requestId,
    now,
  });
  return { ok: true, value: accepted, requestId: command.requestId };
}
