import type {
  AdminPaymentReactionRetryResult,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { reactionRetryEvidence } from "../infrastructure/d1/reaction-recovery-evidence";

const scope = "admin.payments.payment-reaction-retry";
const authority = `EXISTS (SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='payments.manage' JOIN staff_scope scope ON scope.staff_id=s.id AND scope.scope_kind='global' WHERE s.auth_user_id=? AND s.status='active')`;
const receipt = z.object({
  caseId: z.string(),
  version: z.number().int().safe().positive(),
  state: z.literal("QUEUED"),
  acceptedAt: z.string().datetime(),
});
export async function retryPaymentReaction(
  database: D1Database,
  command: {
    caseId: string;
    expectedVersion: number;
    expectedPaymentVersion: number;
    reason: string;
    idempotencyKey: string;
    actorAuthUserId: string;
    requestId: string;
  },
): Promise<RpcResult<AdminPaymentReactionRetryResult>> {
  const fail = (
    code: AppErrorCode,
    message: string,
  ): RpcResult<AdminPaymentReactionRetryResult> => ({
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
    command.expectedVersion < 1 ||
    !Number.isSafeInteger(command.expectedPaymentVersion) ||
    command.expectedPaymentVersion < 1
  )
    return fail("VALIDATION_FAILED", "A current case version, stable key and reason are required");
  if (
    !(await database.prepare(`SELECT 1 WHERE ${authority}`).bind(command.actorAuthUserId).first())
  )
    return fail("FORBIDDEN", "Global payment permission is required");
  const hash = await requestHash({
    caseId: command.caseId,
    expectedVersion: command.expectedVersion,
    expectedPaymentVersion: command.expectedPaymentVersion,
    reason,
    actorAuthUserId: command.actorAuthUserId,
  });
  async function replay(): Promise<RpcResult<AdminPaymentReactionRetryResult> | null> {
    const saved = await findIdempotencyRecord(database, scope, command.idempotencyKey);
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
  const row = await database
    .prepare(`SELECT r.id,r.payment_intent_id,r.reaction_type,r.subject_type,r.subject_id,r.attempts,r.available_at,p.version payment_version
    FROM payment_reconciliation_case c JOIN payment_reaction r ON r.id=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.reactionId') END AND r.payment_intent_id=c.payment_intent_id
    JOIN payment_intent p ON p.id=r.payment_intent_id
    WHERE c.id=? AND c.version=? AND c.status='OPEN' AND c.category='REACTION_FAILURE' AND p.version=? AND ${reactionRetryEvidence}`)
    .bind(command.caseId, command.expectedVersion, command.expectedPaymentVersion)
    .first<{
      id: string;
      payment_intent_id: string;
      reaction_type: string;
      subject_type: string;
      subject_id: string;
      attempts: number;
      available_at: number | null;
      payment_version: number;
    }>();
  if (!row)
    return fail(
      "CONFLICT",
      "A captured commerce payment and exhausted reaction are required at the current versions",
    );
  const now = Date.now();
  const accepted: AdminPaymentReactionRetryResult = {
    caseId: command.caseId,
    version: command.expectedVersion + 1,
    state: "QUEUED",
    acceptedAt: new Date(now).toISOString(),
  };
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT ${authority}`)
        .bind(command.actorAuthUserId),
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','payment_reaction_retry',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash=excluded.request_hash",
        )
        .bind(scope, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          `UPDATE payment_reconciliation_case SET version=version+1 WHERE id=? AND version=? AND status='OPEN' AND category='REACTION_FAILURE' AND payment_intent_id=? AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.reactionId') END=?`,
        )
        .bind(command.caseId, command.expectedVersion, row.payment_intent_id, row.id),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM payment_reaction r JOIN payment_intent p ON p.id=r.payment_intent_id WHERE r.id=? AND p.version=? AND ${reactionRetryEvidence})`,
        )
        .bind(row.id, command.expectedPaymentVersion),
      database
        .prepare(
          `UPDATE payment_reaction SET status='PENDING',attempts=0,available_at=?,last_error_code='OPERATOR_RETRY_REQUESTED',updated_at=? WHERE id=? AND payment_intent_id=? AND reaction_type=? AND subject_type=? AND subject_id=? AND status='ESCALATED' AND attempts=? AND (available_at IS NULL OR available_at<=?)`,
        )
        .bind(
          now,
          now,
          row.id,
          row.payment_intent_id,
          row.reaction_type,
          row.subject_type,
          row.subject_id,
          row.attempts,
          now,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.REACTION_RETRY_REQUESTED",
        resourceType: "payment_reconciliation_case",
        resourceId: command.caseId,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        occurredAt: now,
        details: {
          reactionId: row.id,
          previousAttempts: row.attempts,
          previousAvailableAt: row.available_at,
          paymentVersion: row.payment_version,
        },
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.REACTION_RETRY_REQUESTED' AND idempotency_key=?)",
        )
        .bind(command.caseId, command.idempotencyKey),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(accepted), now, scope, command.idempotencyKey, hash),
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
        "Case, payment, reaction recovery or authority changed; refresh before retrying",
      );
    throw error;
  }
  return { ok: true, value: accepted, requestId: command.requestId };
}
