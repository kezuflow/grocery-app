import type {
  AdminProviderEventRetryResult,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { parseNormalizedProviderObservation } from "./redrive-provider-inbox";

const scope = "admin.payments.provider-event-retry";
const authority = `EXISTS (SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='payments.manage' JOIN staff_scope scope ON scope.staff_id=s.id AND scope.scope_kind='global' WHERE s.auth_user_id=? AND s.status='active')`;
const receipt = z.object({
  caseId: z.string(),
  version: z.number().int().safe().positive(),
  state: z.literal("QUEUED"),
  acceptedAt: z.string().datetime(),
});
export async function retryProviderEvent(
  database: D1Database,
  command: {
    caseId: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    actorAuthUserId: string;
    requestId: string;
  },
): Promise<RpcResult<AdminProviderEventRetryResult>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<AdminProviderEventRetryResult> => ({
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
    return fail("VALIDATION_FAILED", "A current case version, stable key and reason are required");
  if (
    !(await database.prepare(`SELECT 1 WHERE ${authority}`).bind(command.actorAuthUserId).first())
  )
    return fail("FORBIDDEN", "Global payment permission is required");
  const hash = await requestHash({
    caseId: command.caseId,
    expectedVersion: command.expectedVersion,
    reason,
    actorAuthUserId: command.actorAuthUserId,
  });
  async function replay(): Promise<RpcResult<AdminProviderEventRetryResult> | null> {
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
    .prepare(`SELECT i.id,i.provider,i.provider_event_id,i.payload_hash,i.normalized_observation_json,i.signature_verified_at,i.attempts,i.received_at,i.recovery_started_at
    FROM payment_reconciliation_case c JOIN payment_provider_event_inbox i
    ON i.provider=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.provider') END
    AND i.provider_event_id=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.providerEventId') END
    WHERE c.id=? AND c.version=? AND c.status='OPEN' AND CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.reason') END='INBOX_REDRIVE_EXHAUSTED'
    AND i.processing_status='RECONCILIATION_REQUIRED' AND i.last_error_code='INBOX_REDRIVE_EXHAUSTED'`)
    .bind(command.caseId, command.expectedVersion)
    .first<{
      id: string;
      provider: string;
      provider_event_id: string;
      payload_hash: string;
      normalized_observation_json: string | null;
      signature_verified_at: number | null;
      attempts: number;
      received_at: number;
      recovery_started_at: number | null;
    }>();
  if (!row || !row.normalized_observation_json || row.signature_verified_at === null)
    return fail("CONFLICT", "No verified exhausted event is available for this case version");
  const event = parseNormalizedProviderObservation(row.normalized_observation_json);
  if (
    !event ||
    !["payment", "refund"].includes(event.kind) ||
    event.provider !== row.provider ||
    event.providerEventId !== row.provider_event_id ||
    event.payloadHash !== row.payload_hash
  )
    return fail("CONFLICT", "Stored provider evidence requires review before retry");
  const now = Date.now();
  const accepted: AdminProviderEventRetryResult = {
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
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','provider_event_retry',?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash=excluded.request_hash",
        )
        .bind(scope, command.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(`UPDATE payment_reconciliation_case SET version=version+1 WHERE id=? AND version=? AND status='OPEN'
        AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.provider') END=?
        AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.providerEventId') END=?
        AND CASE WHEN json_valid(details_json) THEN json_extract(details_json,'$.reason') END='INBOX_REDRIVE_EXHAUSTED'`)
        .bind(command.caseId, command.expectedVersion, row.provider, row.provider_event_id),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      database
        .prepare(`UPDATE payment_provider_event_inbox SET processing_status='RETRY_REQUIRED',last_error_code='OPERATOR_RETRY_REQUESTED',attempts=0,recovery_started_at=?,available_at=?,processed_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
        WHERE id=? AND processing_status='RECONCILIATION_REQUIRED' AND last_error_code='INBOX_REDRIVE_EXHAUSTED' AND attempts=?
        AND provider=? AND provider_event_id=? AND payload_hash=? AND normalized_observation_json=? AND signature_verified_at=?
        AND received_at=? AND recovery_started_at IS ?
        AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)`)
        .bind(
          now,
          now,
          now,
          row.id,
          row.attempts,
          row.provider,
          row.provider_event_id,
          row.payload_hash,
          row.normalized_observation_json,
          row.signature_verified_at,
          row.received_at,
          row.recovery_started_at,
          now,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
      auditEventStatement(database, {
        actorUserId: command.actorAuthUserId,
        action: "PAYMENT.PROVIDER_EVENT_RETRY_REQUESTED",
        resourceType: "payment_reconciliation_case",
        resourceId: command.caseId,
        reason,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.requestId,
        occurredAt: now,
        details: {
          inboxId: row.id,
          previousAttempts: row.attempts,
          receivedAt: row.received_at,
          previousRecoveryStartedAt: row.recovery_started_at,
        },
      }),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.PROVIDER_EVENT_RETRY_REQUESTED' AND idempotency_key=?)",
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
        "Case, provider event, active recovery or authority changed; refresh before retrying",
      );
    throw error;
  }
  return { ok: true, value: accepted, requestId: command.requestId };
}
