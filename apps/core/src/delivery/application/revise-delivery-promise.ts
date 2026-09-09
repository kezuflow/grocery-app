import type {
  ReviseDeliveryPromiseRequest,
  ReviseDeliveryPromiseResult,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { preHandoverRetrySql } from "./pre-handover-retry";

const identity = z.string().trim().min(1).max(200);
const schema = z.object({
  locationId: identity,
  jobId: identity,
  expectedVersion: z.number().int().positive(),
  promisedAt: z.string().datetime(),
  agreementNote: z.string().trim().min(1).max(1000),
  idempotencyKey: identity,
});
const resultSchema = z.object({
  revisionId: identity,
  jobId: identity,
  promisedAt: z.string().datetime(),
  version: z.number().int().positive(),
});
const SCOPE = "delivery.promiseRevision";

/** Change the operational deadline only after recorded customer agreement. Paid snapshots stay immutable. */
export async function reviseDeliveryPromise(
  deps: OperationsAdministrationDeps & { now?: () => number },
  request: ReviseDeliveryPromiseRequest,
): Promise<RpcResult<ReviseDeliveryPromiseResult>> {
  const fail = (
    code:
      | "VALIDATION_FAILED"
      | "NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "CONFLICT"
      | "STALE_VERSION"
      | "ILLEGAL_TRANSITION",
    message: string,
  ): RpcResult<ReviseDeliveryPromiseResult> => ({
    ok: false,
    error: { code, message, requestId: request.requestId },
  });
  const parsed = schema.safeParse(request);
  if (!parsed.success)
    return fail(
      "VALIDATION_FAILED",
      "Enter the agreed delivery time and a short record of the customer's agreement",
    );
  const command = parsed.data;
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    command.locationId,
  );
  if (!access.ok) return access;
  const db = deps.db;
  const row = await db
    .prepare(`SELECT job.version,job.order_id,
    COALESCE((SELECT revision.promised_at FROM delivery_promise_revision revision WHERE revision.delivery_job_id=job.id ORDER BY revision.job_version DESC LIMIT 1),
      CASE WHEN job.fulfillment_mode='INSTANT' THEN snapshot.promised_at ELSE COALESCE(delivery_window.ends_at,snapshot.delivery_date) END) AS promised_at,
    attempt.id AS dispatch_id,attempt.version AS dispatch_version,
    (${preHandoverRetrySql}) AS eligible
    FROM delivery_job job JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=job.order_id
    LEFT JOIN order_delivery_window_snapshot delivery_window ON delivery_window.order_id=job.order_id
    LEFT JOIN delivery_provider_dispatch attempt ON attempt.id=(SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=job.id ORDER BY attempt_sequence DESC LIMIT 1)
    WHERE job.id=? AND job.location_id=?`)
    .bind(command.jobId, command.locationId)
    .first<{
      version: number;
      order_id: string;
      promised_at: number | null;
      dispatch_id: string | null;
      dispatch_version: number | null;
      eligible: number;
    }>();
  if (!row) return fail("NOT_FOUND", "Delivery is unavailable");
  const hash = await requestHash({ ...command, actorUserId: access.value.authUserId });
  async function replay(): Promise<RpcResult<ReviseDeliveryPromiseResult> | null> {
    const prior = await findIdempotencyRecord(db, SCOPE, command.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This request key belongs to a different agreement");
    return prior.status === "SUCCEEDED"
      ? {
          ok: true,
          value: resultSchema.parse(JSON.parse(prior.resultReference ?? "null")),
          requestId: request.requestId,
        }
      : fail("CONFLICT", "The saved agreement has not completed");
  }
  const prior = await replay();
  if (prior) return prior;
  if (row.version !== command.expectedVersion)
    return fail("STALE_VERSION", "Delivery changed; refresh before recording the agreement");
  if (!row.eligible || !row.dispatch_id || row.promised_at === null)
    return fail(
      "ILLEGAL_TRANSITION",
      "Close the prior courier attempt before changing the delivery time; returned goods require inspection first",
    );
  const now = (deps.now ?? Date.now)();
  const promisedAt = Date.parse(command.promisedAt);
  if (promisedAt <= now || promisedAt === row.promised_at)
    return fail("VALIDATION_FAILED", "Choose a new agreed delivery time in the future");
  const result = {
    revisionId: crypto.randomUUID(),
    jobId: command.jobId,
    promisedAt: new Date(promisedAt).toISOString(),
    version: row.version + 1,
  };
  const guard = () => db.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1");
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id
        JOIN permission p ON p.id=rp.permission_id AND p.code='delivery.manage' JOIN staff_scope scope ON scope.staff_id=staff.id
        JOIN fulfillment_location location ON location.id=? WHERE staff.auth_user_id=? AND staff.status='active'
        AND (scope.scope_kind='global' OR (scope.scope_kind='location' AND scope.location_id=location.id) OR (scope.scope_kind='market' AND scope.market_id=location.market_id)))`)
        .bind(command.locationId, access.value.authUserId),
      // Preserve the delivery-status timestamp; agreement time lives in its own record.
      db
        .prepare(`UPDATE delivery_job AS job SET promised_at=?,version=version+1 WHERE job.id=? AND job.location_id=? AND job.version=? AND ${preHandoverRetrySql}
        AND EXISTS (SELECT 1 FROM delivery_provider_dispatch attempt WHERE attempt.id=? AND attempt.version=? AND attempt.attempt_sequence=(SELECT MAX(attempt_sequence) FROM delivery_provider_dispatch WHERE delivery_job_id=job.id))`)
        .bind(
          promisedAt,
          command.jobId,
          command.locationId,
          row.version,
          row.dispatch_id,
          row.dispatch_version,
        ),
      guard(),
      db
        .prepare(
          `INSERT INTO delivery_promise_revision(id,delivery_job_id,dispatch_id,job_version,previous_promised_at,promised_at,agreement_note,actor_user_id,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          result.revisionId,
          command.jobId,
          row.dispatch_id,
          result.version,
          row.promised_at,
          promisedAt,
          command.agreementNote,
          access.value.authUserId,
          now,
        ),
      guard(),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "DELIVERY.PROMISE_REVISED",
        resourceType: "delivery_job",
        resourceId: command.jobId,
        locationId: command.locationId,
        correlationId: request.requestId,
        idempotencyKey: command.idempotencyKey,
        occurredAt: now,
        before: { promisedAt: row.promised_at },
        after: result,
      }),
      guard(),
      db
        .prepare(
          `INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at) VALUES (?,?,?,'SUCCEEDED','delivery_promise_revision',?,?,?)`,
        )
        .bind(SCOPE, command.idempotencyKey, hash, JSON.stringify(result), now, now),
      guard(),
    ]);
  } catch (error) {
    const replayed = await replay();
    if (replayed) return replayed;
    if (!(error instanceof Error) || !/constraint failed/i.test(error.message)) throw error;
    return fail(
      "STALE_VERSION",
      "Delivery or access changed; refresh before recording the agreement",
    );
  }
  return { ok: true, value: result, requestId: request.requestId };
}
