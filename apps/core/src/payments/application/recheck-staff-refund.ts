import type { AdminRefundRecheckResult, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const SCOPE = "admin.payments.refund-recheck";
const authority = `EXISTS (SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='refunds.manage' JOIN staff_scope scope ON scope.staff_id=staff.id AND scope.scope_kind='global' WHERE staff.auth_user_id=? AND staff.status='active')`;
const receipt = z.object({
  refundId: z.string(),
  state: z.literal("QUEUED"),
  version: z.number().int().safe().positive(),
  acceptedAt: z.string().datetime(),
});
type Command = {
  refundId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  actorAuthUserId: string;
  requestId: string;
};
export async function recheckStaffRefund(
  database: D1Database,
  command: Command,
): Promise<RpcResult<AdminRefundRecheckResult>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<AdminRefundRecheckResult> => ({
    ok: false,
    error: { code, message, requestId: command.requestId },
  });
  const reason = command.reason.trim();
  if (
    !reason ||
    reason.length > 500 ||
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
  async function replay(): Promise<RpcResult<AdminRefundRecheckResult> | null> {
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
  const accepted: AdminRefundRecheckResult = {
    refundId: command.refundId,
    state: "QUEUED",
    version: command.expectedVersion + 1,
    acceptedAt: new Date(now).toISOString(),
  };
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT ${authority}`)
        .bind(command.actorAuthUserId),
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','refund_recheck',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash=excluded.request_hash",
        )
        .bind(SCOPE, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          "UPDATE payment_refund SET next_retry_at=?,attempt_count=0,processing_started_at=NULL,last_error_code=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND (processing_started_at IS NULL OR next_retry_at<=?) AND (status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') OR (status IN ('SUCCEEDED','FAILED') AND next_retry_at IS NOT NULL))",
        )
        .bind(now, now, command.refundId, command.expectedVersion, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.REFUND_RECHECK_REQUESTED",
        resourceType: "payment_refund",
        resourceId: command.refundId,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        details: { expectedVersion: command.expectedVersion },
        occurredAt: now,
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.REFUND_RECHECK_REQUESTED' AND idempotency_key=?)",
        )
        .bind(command.refundId, command.idempotencyKey),
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
        "Refund, active recovery or authority changed; refresh before rechecking",
      );
    throw error;
  }
  return { ok: true, value: accepted, requestId: command.requestId };
}
