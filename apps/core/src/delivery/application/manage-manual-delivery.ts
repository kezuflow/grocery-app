import type {
  ManualDeliveryRequest,
  ManualDeliveryResult,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { manualDeliveryActions } from "../domain/manual-delivery";

const identity = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(1000);
const cost = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const common = {
  locationId: identity,
  jobId: identity,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: identity,
};
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    ...common,
    action: z.literal("ASSIGN"),
    reason,
    personName: z.string().trim().min(1).max(120),
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
  z.object({ ...common, action: z.literal("HAND_OVER"), dispatchId: identity }),
  z.object({
    ...common,
    action: z.literal("COMPLETE"),
    dispatchId: identity,
    actualCostMinor: cost,
  }),
  z.object({
    ...common,
    action: z.literal("FAIL"),
    dispatchId: identity,
    reason,
    actualCostMinor: cost,
  }),
]);
const resultSchema = z.object({
  dispatchId: identity,
  jobId: identity,
  status: z.enum(["ACTIVE", "COMPLETED", "FAILED"]),
  version: z.number().int().positive(),
});
const SCOPE = "delivery.manual";

/** A local delivery command: custody, Order progress, audit and receipt commit together. */
export async function manageManualDelivery(
  deps: OperationsAdministrationDeps,
  request: ManualDeliveryRequest,
): Promise<RpcResult<ManualDeliveryResult>> {
  const parsed = commandSchema.safeParse(request);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Valid manual delivery details are required",
        requestId: request.requestId,
      },
    };
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
    .prepare(`SELECT job.order_id,job.fulfillment_mode,job.status,job.version,
    grocery.status AS order_status,grocery.version AS order_version,grocery.currency,
    grocery.delivery_subtotal_minor-grocery.delivery_discount_minor+
      COALESCE((SELECT SUM(delivery_subtotal_minor-delivery_discount_minor) FROM paid_order_amendment WHERE order_id=grocery.id AND status='COMMITTED'),0) AS customer_charge,
    fulfillment.status AS fulfillment_status,fulfillment.version AS fulfillment_version,
    attempt.id AS dispatch_id,attempt.method,attempt.status AS attempt_status,attempt.version AS attempt_version,
    EXISTS (SELECT 1 FROM delivery_promise_revision revision WHERE revision.dispatch_id=attempt.id AND revision.return_inspected_at IS NOT NULL) AS returned_goods_inspected,
    attempt.handed_over_at,COALESCE(attempt.attempt_sequence,0) AS attempt_sequence,
    EXISTS (SELECT 1 FROM delivery_provider_command c JOIN delivery_provider_dispatch d ON d.id=c.dispatch_id
      WHERE d.delivery_job_id=job.id AND c.operation='CANCEL' AND c.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED')) AS pending_cancel
    FROM delivery_job job JOIN grocery_order grocery ON grocery.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id AND fulfillment.location_id=job.location_id
    LEFT JOIN delivery_provider_dispatch attempt ON attempt.id=(SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=job.id ORDER BY attempt_sequence DESC LIMIT 1)
    WHERE job.id=? AND job.location_id=? AND job.batch_id IS NULL AND job.rider_id IS NULL`)
    .bind(command.jobId, command.locationId)
    .first<{
      order_id: string;
      fulfillment_mode: string;
      status: string;
      version: number;
      order_status: string;
      order_version: number;
      currency: string;
      customer_charge: number;
      fulfillment_status: string;
      fulfillment_version: number;
      dispatch_id: string | null;
      method: string | null;
      attempt_status: string | null;
      attempt_version: number | null;
      handed_over_at: number | null;
      attempt_sequence: number;
      pending_cancel: number;
      returned_goods_inspected: number;
    }>();
  const fail = (
    code:
      | "NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "CONFLICT"
      | "STALE_VERSION"
      | "ILLEGAL_TRANSITION",
    message: string,
  ): RpcResult<ManualDeliveryResult> => ({
    ok: false,
    error: { code, message, requestId: request.requestId },
  });
  if (!row) return fail("NOT_FOUND", "Delivery is unavailable");
  const hash = await requestHash({ ...command, actorUserId: access.value.authUserId });
  async function replay(): Promise<RpcResult<ManualDeliveryResult> | null> {
    const prior = await findIdempotencyRecord(db, SCOPE, command.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This request key belongs to different delivery details");
    return prior.status === "SUCCEEDED"
      ? {
          ok: true,
          value: resultSchema.parse(JSON.parse(prior.resultReference ?? "null")),
          requestId: request.requestId,
        }
      : fail("CONFLICT", "The saved delivery request has not completed");
  }
  const prior = await replay();
  if (prior) return prior;
  const actions = manualDeliveryActions({
    mode: row.fulfillment_mode,
    returnedGoodsInspected: Boolean(row.returned_goods_inspected),
    jobStatus: row.status,
    orderStatus: row.order_status,
    fulfillmentStatus: row.fulfillment_status,
    pendingCancellation: row.pending_cancel !== 0,
    attempt:
      row.dispatch_id && row.method && row.attempt_status
        ? { method: row.method, status: row.attempt_status, handedOverAt: row.handed_over_at }
        : null,
  });
  if (!actions.includes(command.action))
    return fail(
      "ILLEGAL_TRANSITION",
      "This manual delivery action is not available; handover requires packed goods and completion requires recorded handover",
    );
  if (
    command.expectedVersion !== (command.action === "ASSIGN" ? row.version : row.attempt_version) ||
    (command.action !== "ASSIGN" && command.dispatchId !== row.dispatch_id)
  )
    return fail("STALE_VERSION", "Delivery changed; refresh before retrying");
  const now = Date.now();
  const dispatchId =
    command.action === "ASSIGN" ? `manual:${crypto.randomUUID()}` : command.dispatchId;
  const result: ManualDeliveryResult = {
    dispatchId,
    jobId: command.jobId,
    status:
      command.action === "COMPLETE" ? "COMPLETED" : command.action === "FAIL" ? "FAILED" : "ACTIVE",
    version: command.action === "ASSIGN" ? 1 : command.expectedVersion + 1,
  };
  const jobStatus = {
    ASSIGN: "ASSIGNED",
    HAND_OVER: "EN_ROUTE",
    COMPLETE: "DELIVERED",
    FAIL: "FAILED",
  }[command.action];
  const guard = () => db.prepare("INSERT INTO commitment_abort(id) SELECT -38 WHERE changes()<>1");
  const statements = [
    ...("actualCostMinor" in command && command.actualCostMinor !== null
      ? [
          db
            .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (
        SELECT 1 FROM grocery_order grocery WHERE grocery.id=? AND grocery.currency=? AND
        grocery.delivery_subtotal_minor-grocery.delivery_discount_minor+
          COALESCE((SELECT SUM(delivery_subtotal_minor-delivery_discount_minor) FROM paid_order_amendment WHERE order_id=grocery.id AND status='COMMITTED'),0)=?)`)
            .bind(row.order_id, row.currency, row.customer_charge),
        ]
      : []),
    ...(row.dispatch_id
      ? [
          db
            .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS
      (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND version=? AND status=? AND handed_over_at IS ?)`)
            .bind(row.dispatch_id, row.attempt_version, row.attempt_status, row.handed_over_at),
        ]
      : []),
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id
      JOIN permission p ON p.id=rp.permission_id AND p.code='delivery.manage' JOIN staff_scope scope ON scope.staff_id=staff.id
      JOIN fulfillment_location location ON location.id=? WHERE staff.auth_user_id=? AND staff.status='active'
      AND (scope.scope_kind='global' OR (scope.scope_kind='location' AND scope.location_id=location.id) OR (scope.scope_kind='market' AND scope.market_id=location.market_id)))`)
      .bind(command.locationId, access.value.authUserId),
    db
      .prepare(
        `INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','manual_delivery',?,?)`,
      )
      .bind(SCOPE, command.idempotencyKey, hash, now, now),
    guard(),
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -38 WHERE
      NOT EXISTS (SELECT 1 FROM grocery_order WHERE id=? AND status=? AND version=? AND fulfillment_mode='SCHEDULED')
      OR NOT EXISTS (SELECT 1 FROM fulfillment_record WHERE order_id=? AND location_id=? AND status=? AND version=?)
      OR COALESCE((SELECT MAX(attempt_sequence) FROM delivery_provider_dispatch WHERE delivery_job_id=?),0)<>?
      OR EXISTS (SELECT 1 FROM delivery_provider_command c JOIN delivery_provider_dispatch d ON d.id=c.dispatch_id WHERE d.delivery_job_id=? AND c.operation='CANCEL' AND c.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`)
      .bind(
        row.order_id,
        row.order_status,
        row.order_version,
        row.order_id,
        command.locationId,
        row.fulfillment_status,
        row.fulfillment_version,
        command.jobId,
        row.attempt_sequence,
        command.jobId,
      ),
    db
      .prepare(
        `UPDATE delivery_job SET status=?,delivered_at=?,version=version+1,updated_at=? WHERE id=? AND location_id=? AND version=? AND status=? AND fulfillment_mode='SCHEDULED' AND batch_id IS NULL AND rider_id IS NULL`,
      )
      .bind(
        jobStatus,
        command.action === "COMPLETE" ? now : null,
        now,
        command.jobId,
        command.locationId,
        row.version,
        row.status,
      ),
    guard(),
    db
      .prepare(
        `UPDATE delivery_stop SET status=?,delivered_at=?,version=version+1,updated_at=? WHERE delivery_job_id=? AND status=?`,
      )
      .bind(jobStatus, command.action === "COMPLETE" ? now : null, now, command.jobId, row.status),
    guard(),
  ];
  if (command.action === "ASSIGN") {
    statements.push(
      db
        .prepare(`INSERT INTO delivery_provider_dispatch
      (id,delivery_job_id,attempt_sequence,method,manual_reason,manual_person_name,manual_phone_e164,
      merchant_order_id,request_hash,request_snapshot_json,status,version,created_at,updated_at,client_idempotency_key)
      VALUES (?,?,?,'MANUAL',?,?,?,?,?,?,'ACTIVE',1,?,?,?)`)
        .bind(
          dispatchId,
          command.jobId,
          row.attempt_sequence + 1,
          command.reason,
          command.personName,
          command.phoneE164,
          dispatchId,
          hash,
          JSON.stringify(command),
          now,
          now,
          command.idempotencyKey,
        ),
      guard(),
    );
  } else {
    const actualCost =
      command.action === "COMPLETE" || command.action === "FAIL" ? command.actualCostMinor : null;
    statements.push(
      db
        .prepare(`UPDATE delivery_provider_dispatch SET status=?,handed_over_at=?,completed_at=?,final_payable_minor=?,
      customer_delivery_charge_minor=?,delivery_currency=?,courier_variance_minor=?,version=version+1,updated_at=?
      WHERE id=? AND delivery_job_id=? AND method='MANUAL' AND status='ACTIVE' AND version=? AND handed_over_at IS ?`)
        .bind(
          result.status,
          command.action === "HAND_OVER" ? now : row.handed_over_at,
          command.action === "COMPLETE" ? now : null,
          actualCost,
          actualCost === null ? null : row.customer_charge,
          actualCost === null ? null : row.currency,
          actualCost === null ? null : actualCost - row.customer_charge,
          now,
          dispatchId,
          command.jobId,
          command.expectedVersion,
          row.handed_over_at,
        ),
      guard(),
    );
  }
  if (command.action === "HAND_OVER" || command.action === "COMPLETE") {
    statements.push(
      db
        .prepare(
          "UPDATE fulfillment_record SET status=?,version=version+1,updated_at=? WHERE order_id=? AND version=? AND status=?",
        )
        .bind(
          command.action === "HAND_OVER" ? "HANDED_OFF" : "COMPLETED",
          now,
          row.order_id,
          row.fulfillment_version,
          row.fulfillment_status,
        ),
      guard(),
      db
        .prepare(
          "UPDATE grocery_order SET status=?,version=version+1 WHERE id=? AND version=? AND status=?",
        )
        .bind(
          command.action === "HAND_OVER" ? "OUT_FOR_DELIVERY" : "DELIVERED",
          row.order_id,
          row.order_version,
          row.order_status,
        ),
      guard(),
    );
  }
  statements.push(
    auditEventStatement(db, {
      actorUserId: access.value.authUserId,
      action: `DELIVERY.MANUAL_${command.action}`,
      resourceType: "delivery_provider_dispatch",
      resourceId: dispatchId,
      locationId: command.locationId,
      reason: "reason" in command ? command.reason : null,
      correlationId: request.requestId,
      idempotencyKey: command.idempotencyKey,
      occurredAt: now,
      before: { jobStatus: row.status, attemptVersion: row.attempt_version },
      after: {
        ...result,
        jobStatus,
        actualCostMinor: "actualCostMinor" in command ? command.actualCostMinor : null,
      },
    }),
    guard(),
    db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(result), now, SCOPE, command.idempotencyKey, hash),
    guard(),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const replayed = await replay();
    if (replayed) return replayed;
    if (!(error instanceof Error) || !/constraint failed|DELIVERY_ATTEMPT_/i.test(error.message))
      throw error;
    return fail("STALE_VERSION", "Delivery or access changed; refresh before retrying");
  }
  return { ok: true, value: result, requestId: request.requestId };
}
