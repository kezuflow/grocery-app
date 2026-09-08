import type { AdminReconciliationCaseView, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  completedReconciliationResolutionEvidence,
  refundedCommitmentResolutionEvidence,
  reconciliationResolutionEvidence,
  unresolvedReconciliationReason,
} from "../infrastructure/d1/reconciliation-resolution";
import { prepareRefundedCommitmentResolution } from "./prepare-refunded-commitment-resolution";
const scope = "admin.payments.reconcile";
const receipt = z.object({
  resolutionAction: z.enum(["RESOLVE", "CONFIRM_REFUNDED_COMMITMENT"]).optional(),
  caseId: z.string(),
  paymentIntentId: z.string().nullable(),
  category: z.enum([
    "UNMAPPED_PROVIDER_REFERENCE",
    "AMBIGUOUS_OUTCOME",
    "PROVIDER_TIMEOUT",
    "REACTION_FAILURE",
    "REFUND_UNRESOLVED",
  ]),
  status: z.literal("RESOLVED"),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime(),
  version: z.number().int().safe().positive(),
  resolutionUnavailableReason: z.null(),
});
type Command = {
  caseId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  actorAuthUserId: string;
  requestId: string;
};
export async function resolveReconciliationCase(
  database: D1Database,
  command: Command,
): Promise<RpcResult<AdminReconciliationCaseView>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<AdminReconciliationCaseView> => ({
    ok: false,
    error: { code, message, requestId: command.requestId },
  });
  const reason = command.reason.trim();
  if (
    !reason ||
    reason.length > 500 ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1 ||
    !command.idempotencyKey.trim()
  )
    return fail("VALIDATION_FAILED", "A current case version, stable key and reason are required");
  const authority = `EXISTS (SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='refunds.manage' JOIN staff_scope scope ON scope.staff_id=s.id AND scope.scope_kind='global' WHERE s.auth_user_id=? AND s.status='active')`;
  if (
    !(await database.prepare(`SELECT 1 WHERE ${authority}`).bind(command.actorAuthUserId).first())
  )
    return fail("FORBIDDEN", "Global refund permission is required");
  const hash = await requestHash({
    caseId: command.caseId,
    expectedVersion: command.expectedVersion,
    reason,
    actorAuthUserId: command.actorAuthUserId,
  });
  const legacyHash = await requestHash({ caseId: command.caseId, reason });
  async function replay(): Promise<RpcResult<AdminReconciliationCaseView> | null> {
    const saved = await findIdempotencyRecord(database, scope, command.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to a different resolution");
    if (saved.status === "SUCCEEDED") {
      if (!saved.resultReference?.startsWith("{"))
        return fail(
          "CONFLICT",
          "This historical resolution was already recorded; inspect current case progress",
        );
      return {
        ok: true,
        value: receipt.parse(JSON.parse(saved.resultReference)),
        requestId: command.requestId,
      };
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const row = await database
    .prepare(
      `SELECT id,payment_intent_id,category,status,created_at,version,(${reconciliationResolutionEvidence}) eligible,(${refundedCommitmentResolutionEvidence}) refunded_commitment FROM payment_reconciliation_case WHERE id=?`,
    )
    .bind(command.caseId)
    .first<{
      id: string;
      payment_intent_id: string | null;
      category: AdminReconciliationCaseView["category"];
      status: string;
      created_at: number;
      version: number;
      eligible: number;
      refunded_commitment: number;
    }>();
  if (!row) return fail("NOT_FOUND", "Reconciliation case not found");
  if (row.version !== command.expectedVersion)
    return fail("STALE_VERSION", "Case changed; refresh before resolving");
  if (row.status !== "OPEN") return fail("ILLEGAL_TRANSITION", "Only open cases can be resolved");
  if (!row.eligible) return fail("CONFLICT", unresolvedReconciliationReason);
  const now = Date.now();
  const accepted: AdminReconciliationCaseView = {
    resolutionAction: row.refunded_commitment ? "CONFIRM_REFUNDED_COMMITMENT" : "RESOLVE",
    caseId: row.id,
    paymentIntentId: row.payment_intent_id,
    category: row.category,
    status: "RESOLVED",
    version: row.version + 1,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: new Date(now).toISOString(),
    resolutionUnavailableReason: null,
  };
  try {
    const refundedCleanup = row.refunded_commitment
      ? await prepareRefundedCommitmentResolution(database, { ...command, reason, now })
      : [];
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT ${authority}`)
        .bind(command.actorAuthUserId),
      database
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','reconciliation_case',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',request_hash=excluded.request_hash,updated_at=excluded.updated_at WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash IN (?,?)",
        )
        .bind(scope, command.idempotencyKey, hash, now, now, hash, legacyHash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      ...refundedCleanup,
      database
        .prepare(
          `UPDATE payment_reconciliation_case SET status='RESOLVED',resolved_at=?,version=version+1 WHERE id=? AND version=? AND status='OPEN' AND payment_intent_id IS ? AND category=? AND created_at=? AND ${completedReconciliationResolutionEvidence}`,
        )
        .bind(now, row.id, row.version, row.payment_intent_id, row.category, row.created_at),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.RECONCILIATION_RESOLVED",
        resourceType: "payment_reconciliation_case",
        resourceId: row.id,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        before: { status: "OPEN", version: row.version },
        after: { status: "RESOLVED", version: row.version + 1 },
        occurredAt: now,
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.RECONCILIATION_RESOLVED' AND idempotency_key=?)",
        )
        .bind(row.id, command.idempotencyKey),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND request_hash=?",
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
      return fail("CONFLICT", "Case, financial evidence or authority changed; refresh");
    throw error;
  }
  return { ok: true, value: accepted, requestId: command.requestId };
}
