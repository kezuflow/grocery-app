import type { AdminRefundView, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { refundBudgetStatement } from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { submitClaimedRefund } from "./request-refund";

type StaffRefundCommand = {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorAuthUserId: string;
  requestId: string;
};
const SCOPE = "admin.payments.refund";
const receiptSchema = z.object({
  refundId: z.string(),
  paymentIntentId: z.string(),
  amountMinor: z.number().int().safe().positive(),
  currency: z.string(),
  status: z.literal("REQUESTED"),
  reason: z.string(),
  createdAt: z.string(),
});
function failure(
  code: AppErrorCode,
  message: string,
  requestId: string,
): RpcResult<AdminRefundView> {
  return { ok: false, error: { code, message, requestId } };
}

/** Admit a Global staff decision atomically, then submit only the newly created Refund identity. */
export async function requestStaffRefund(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: StaffRefundCommand,
): Promise<RpcResult<AdminRefundView>> {
  const reason = command.reason.trim();
  if (
    !reason ||
    !Number.isSafeInteger(command.amountMinor) ||
    command.amountMinor <= 0 ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1 ||
    !command.idempotencyKey.trim()
  )
    return failure(
      "VALIDATION_FAILED",
      "A positive exact amount, reason, payment version and stable key are required",
      command.requestId,
    );
  const legacyHash = await requestHash({
    paymentIntentId: command.paymentIntentId,
    amountMinor: command.amountMinor,
    reason,
  });
  const hash = await requestHash({
    paymentIntentId: command.paymentIntentId,
    amountMinor: command.amountMinor,
    reason,
    expectedVersion: command.expectedVersion,
    actorAuthUserId: command.actorAuthUserId,
  });
  async function replay(): Promise<RpcResult<AdminRefundView> | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key belongs to another refund decision",
        command.requestId,
      );
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return failure(
          "CONFLICT",
          "This historical refund was already recorded; reconcile its existing identity",
          command.requestId,
        );
      return {
        ok: true,
        value: receiptSchema.parse(JSON.parse(saved.resultReference)),
        requestId: command.requestId,
      };
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  if (
    await database
      .prepare("SELECT id FROM payment_refund WHERE idempotency_key=?")
      .bind(command.idempotencyKey)
      .first()
  )
    return failure(
      "CONFLICT",
      "A refund already exists for this key; reconcile its recorded identity",
      command.requestId,
    );
  const payment = await database
    .prepare("SELECT id,amount_minor,currency,status,version FROM payment_intent WHERE id=?")
    .bind(command.paymentIntentId)
    .first<{
      id: string;
      amount_minor: number;
      currency: string;
      status: string;
      version: number;
    }>();
  if (!payment) return failure("NOT_FOUND", "Payment not found", command.requestId);
  if (payment.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Payment changed; refresh before refunding", command.requestId);
  if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))
    return failure(
      "ILLEGAL_TRANSITION",
      "Only captured payments can be refunded",
      command.requestId,
    );
  const reserved = await database
    .prepare(
      "SELECT COALESCE(SUM(amount_minor),0) amount FROM payment_refund WHERE payment_intent_id=? AND status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED')",
    )
    .bind(payment.id)
    .first<{ amount: number }>();
  if (command.amountMinor > payment.amount_minor - (reserved?.amount ?? 0))
    return failure("VALIDATION_FAILED", "Refund exceeds the refundable amount", command.requestId);
  const attempt = await database
    .prepare(
      "SELECT id,provider,provider_reference FROM payment_attempt WHERE payment_intent_id=? AND status='SUCCEEDED' ORDER BY created_at DESC,id LIMIT 1",
    )
    .bind(payment.id)
    .first<{ id: string; provider: string; provider_reference: string | null }>();
  if (!attempt?.provider_reference)
    return failure(
      "CONFIGURATION_ERROR",
      "Captured provider payment evidence is missing",
      command.requestId,
    );
  let provider;
  try {
    provider = registry.require(attempt.provider);
  } catch {
    return failure(
      "CONFIGURATION_ERROR",
      "The captured payment provider is unavailable",
      command.requestId,
    );
  }
  const refundId = crypto.randomUUID(),
    now = Date.now();
  const accepted: AdminRefundView = {
    refundId,
    paymentIntentId: payment.id,
    amountMinor: command.amountMinor,
    currency: payment.currency,
    status: "REQUESTED",
    reason,
    createdAt: new Date(now).toISOString(),
  };
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -40 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
        JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission permission ON permission.id=rp.permission_id AND permission.code='refunds.manage'
        JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global'
        WHERE staff.auth_user_id=? AND staff.status='active')`)
        .bind(command.actorAuthUserId),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -40 WHERE NOT EXISTS (
        SELECT 1 FROM payment_intent payment JOIN payment_attempt attempt ON attempt.payment_intent_id=payment.id
        WHERE payment.id=? AND payment.version=? AND payment.status=? AND payment.amount_minor=? AND payment.currency=?
        AND attempt.id=? AND attempt.status='SUCCEEDED' AND attempt.provider=? AND attempt.provider_reference=?)
        OR EXISTS (SELECT 1 FROM order_cancellation_refund_member member JOIN order_cancellation cancellation ON cancellation.id=member.cancellation_id
          WHERE member.payment_intent_id=? AND cancellation.status!='COMPLETED')`)
        .bind(
          payment.id,
          payment.version,
          payment.status,
          payment.amount_minor,
          payment.currency,
          attempt.id,
          attempt.provider,
          attempt.provider_reference,
          payment.id,
        ),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','payment_refund',?,?)
        ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',request_hash=excluded.request_hash,result_reference=NULL,updated_at=excluded.updated_at
        WHERE idempotency_records.status IN ('FAILED','PROCESSING') AND idempotency_records.request_hash IN (?,?)`)
        .bind(SCOPE, command.idempotencyKey, hash, now, now, hash, legacyHash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -40 WHERE changes()!=1"),
      refundBudgetStatement(database, {
        refundId,
        intentId: payment.id,
        amountMinor: command.amountMinor,
        reason,
        idempotencyKey: command.idempotencyKey,
        now,
      }),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -40 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.REFUND_REQUESTED",
        resourceType: "payment_refund",
        resourceId: refundId,
        reason,
        idempotencyKey: command.idempotencyKey,
        details: {
          paymentIntentId: payment.id,
          amountMinor: command.amountMinor,
          expectedVersion: command.expectedVersion,
        },
        correlationId: command.requestId,
        occurredAt: now,
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -40 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE action='PAYMENT.REFUND_REQUESTED' AND aggregate_id=? AND idempotency_key=?)",
        )
        .bind(refundId, command.idempotencyKey),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(accepted), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -40 WHERE changes()!=1"),
    ]);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return failure(
        "CONFLICT",
        "Payment, refund budget or authority changed; refresh",
        command.requestId,
      );
    throw error;
  }
  // Admission is durable. A provider rejection or unknown response changes
  // canonical Refund progress, never the accepted operation receipt.
  await submitClaimedRefund(database, provider, {
    refundId,
    requestedVersion: 1,
    paymentIntentId: payment.id,
    currency: payment.currency,
    providerCode: attempt.provider,
    providerReference: attempt.provider_reference,
    amountMinor: command.amountMinor,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
    now,
  });
  return { ok: true, value: accepted, requestId: command.requestId };
}
