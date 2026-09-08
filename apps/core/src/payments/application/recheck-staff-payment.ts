import type { AdminPaymentRecheckResult, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const SCOPE = "admin.payments.payment-recheck";
const authority = `EXISTS (SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='payments.manage' JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global' WHERE staff.auth_user_id=? AND staff.status='active')`;
const receipt = z.object({
  paymentIntentId: z.string(),
  state: z.literal("QUEUED"),
  version: z.number().int().safe().positive(),
  acceptedAt: z.string().datetime(),
});
type Command = {
  paymentIntentId: string;
  expectedVersion: number;
  expectedRecoveryVersion: number;
  reason: string;
  idempotencyKey: string;
  actorAuthUserId: string;
  requestId: string;
};
export async function recheckStaffPayment(
  database: D1Database,
  command: Command,
): Promise<RpcResult<AdminPaymentRecheckResult>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<AdminPaymentRecheckResult> => ({
    ok: false,
    error: { code, message, requestId: command.requestId },
  });
  const reason = command.reason.trim();
  if (
    !reason ||
    reason.length > 500 ||
    !command.idempotencyKey.trim() ||
    command.idempotencyKey.length > 200 ||
    !Number.isSafeInteger(command.expectedRecoveryVersion) ||
    command.expectedRecoveryVersion < 0 ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1
  )
    return fail(
      "VALIDATION_FAILED",
      "Current payment/recovery versions, stable key and reason are required",
    );
  if (
    !(await database.prepare(`SELECT 1 WHERE ${authority}`).bind(command.actorAuthUserId).first())
  )
    return fail("FORBIDDEN", "Global payment permission is required");
  const hash = await requestHash({
    paymentIntentId: command.paymentIntentId,
    expectedVersion: command.expectedVersion,
    expectedRecoveryVersion: command.expectedRecoveryVersion,
    reason,
    actorAuthUserId: command.actorAuthUserId,
  });
  async function replay(): Promise<RpcResult<AdminPaymentRecheckResult> | null> {
    const saved = await findIdempotencyRecord(database, SCOPE, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to another recovery decision");
    if (saved.status === "SUCCEEDED")
      return {
        ok: true,
        value: receipt.parse(JSON.parse(saved.resultReference ?? "null")),
        requestId: command.requestId,
      };
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const now = Date.now();
  const accepted: AdminPaymentRecheckResult = {
    paymentIntentId: command.paymentIntentId,
    state: "QUEUED",
    version: command.expectedRecoveryVersion + 1,
    acceptedAt: new Date(now).toISOString(),
  };
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT ${authority}`)
        .bind(command.actorAuthUserId),
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','payment_recheck',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash=excluded.request_hash",
        )
        .bind(SCOPE, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM payment_intent WHERE id=? AND version=? AND status IN ('INITIATED','REQUIRES_ACTION','PROCESSING'))",
        )
        .bind(command.paymentIntentId, command.expectedVersion),
      command.expectedRecoveryVersion === 0
        ? database
            .prepare(
              "INSERT INTO payment_lookup_recovery(payment_intent_id,status,available_at,created_at,updated_at) VALUES (?,'PENDING',?,?,?) ON CONFLICT(payment_intent_id) DO NOTHING",
            )
            .bind(command.paymentIntentId, now, now, now)
        : database
            .prepare(`UPDATE payment_lookup_recovery SET status='PENDING',attempts=0,lease_token=NULL,last_error_code=NULL,available_at=?,version=version+1,updated_at=?
        WHERE payment_intent_id=? AND version=? AND (lease_token IS NULL OR available_at<=?)`)
            .bind(now, now, command.paymentIntentId, command.expectedRecoveryVersion, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.LOOKUP_RECHECK_REQUESTED",
        resourceType: "payment_intent",
        resourceId: command.paymentIntentId,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        details: { expectedVersion: command.expectedVersion },
        occurredAt: now,
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.LOOKUP_RECHECK_REQUESTED' AND idempotency_key=?)",
        )
        .bind(command.paymentIntentId, command.idempotencyKey),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(accepted), now, SCOPE, command.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    ]);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return fail(
        "CONFLICT",
        "Payment, active recovery or authority changed; refresh before rechecking",
      );
    throw error;
  }
  return { ok: true, value: accepted, requestId: command.requestId };
}
