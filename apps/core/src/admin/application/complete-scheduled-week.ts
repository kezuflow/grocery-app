import type {
  RpcResult,
  ScheduledWeekCompletionRequest,
  ScheduledWeekCompletionView,
} from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

const SCOPE = "scheduledWeek.complete";
const SETTLEMENT_MS = 60 * 60_000;

type DemandSummary = { lines: number; orders: number; quantity: number };
const summarySql = `SELECT COUNT(*) lines,COUNT(DISTINCT order_id) orders,
  COALESCE(SUM(quantity_base_total),0) quantity FROM committed_demand
  WHERE delivery_cycle_id=? AND location_id=? AND status='OPEN' AND demand_basis='EXACT_PAID_LINE'`;

function failure(
  code:
    | "VALIDATION_FAILED"
    | "NOT_FOUND"
    | "ILLEGAL_TRANSITION"
    | "STALE_VERSION"
    | "CONFLICT"
    | "IDEMPOTENCY_CONFLICT",
  message: string,
  requestId: string,
): RpcResult<ScheduledWeekCompletionView> {
  return { ok: false, error: { code, message, requestId } };
}

/** One location's physical purchase and packing attestations. No stock is inferred. */
export async function completeScheduledWeek(
  deps: OperationsAdministrationDeps,
  request: ScheduledWeekCompletionRequest,
): Promise<RpcResult<ScheduledWeekCompletionView>> {
  const permitted = await resolveOperationsAdministrationAccess(
    deps,
    request,
    request.action === "PURCHASE_COMPLETE" ? "procurement.manage" : "fulfillment.manage",
    request.locationId,
  );
  if (!permitted.ok) return permitted;
  const payload = {
    cycleId: request.cycleId,
    locationId: request.locationId,
    action: request.action,
    expectedVersion: request.expectedVersion,
    actor: permitted.value.authUserId,
  };
  const hash = await requestHash(payload);
  async function replay(): Promise<RpcResult<ScheduledWeekCompletionView> | null> {
    const saved = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key was used for a different week action",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.resultReference)
      return {
        ok: true,
        value: JSON.parse(saved.resultReference) as ScheduledWeekCompletionView,
        requestId: request.requestId,
      };
    return failure("CONFLICT", "The original week action needs reconciliation", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;

  const cycle = await deps.db
    .prepare(`SELECT c.id,c.status,c.cutoff_at cutoffAt,c.version cycleVersion
    FROM delivery_cycle c JOIN fulfillment_location l ON l.market_id=c.market_id
    WHERE c.id=? AND l.id=?`)
    .bind(request.cycleId, request.locationId)
    .first<{ id: string; status: string; cutoffAt: number; cycleVersion: number }>();
  if (!cycle)
    return failure("NOT_FOUND", "Delivery week was not found at this location", request.requestId);
  const now = Date.now();
  if (cycle.cutoffAt + SETTLEMENT_MS > now || !["OPEN", "CUTOFF_REACHED"].includes(cycle.status))
    return failure(
      "ILLEGAL_TRANSITION",
      "Wait until the payment settlement hour has ended",
      request.requestId,
    );
  const completion = await deps.db
    .prepare(`SELECT version,demand_line_count lines,paid_order_count orders,
    total_quantity_base quantity,purchase_completed_at purchaseCompletedAt,packed_at packedAt
    FROM scheduled_week_completion WHERE cycle_id=? AND location_id=?`)
    .bind(request.cycleId, request.locationId)
    .first<
      DemandSummary & { version: number; purchaseCompletedAt: number; packedAt: number | null }
    >();
  if (
    request.action === "PURCHASE_COMPLETE"
      ? completion !== null || request.expectedVersion !== 0
      : !completion ||
        completion.packedAt !== null ||
        request.expectedVersion !== completion.version
  )
    return failure(
      "STALE_VERSION",
      "This week changed; refresh before continuing",
      request.requestId,
    );
  const demand = await deps.db
    .prepare(summarySql)
    .bind(request.cycleId, request.locationId)
    .first<DemandSummary>();
  if (
    completion &&
    (!demand ||
      completion.lines !== demand.lines ||
      completion.orders !== demand.orders ||
      completion.quantity !== demand.quantity)
  )
    return failure(
      "STALE_VERSION",
      "Paid demand changed after purchase; review the week",
      request.requestId,
    );
  if (!demand || demand.lines < 1 || demand.orders < 1 || demand.quantity < 1)
    return failure(
      "ILLEGAL_TRANSITION",
      "No paid orders are ready for this delivery week",
      request.requestId,
    );
  const result: ScheduledWeekCompletionView = {
    cycleId: request.cycleId,
    locationId: request.locationId,
    version: request.action === "PURCHASE_COMPLETE" ? 1 : 2,
    paidOrderCount: demand.orders,
    purchaseCompletedAt: completion?.purchaseCompletedAt ?? now,
    packedAt: request.action === "FINISH_PACKING" ? now : null,
  };
  const authSql = `EXISTS(SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
    JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
    JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location l ON l.id=?
    WHERE staff.auth_user_id=? AND staff.status='active' AND p.code=?
      AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=l.market_id)
        OR (scope.scope_kind='location' AND scope.location_id=l.id)))`;
  const capability =
    request.action === "PURCHASE_COMPLETE" ? "procurement.manage" : "fulfillment.manage";
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
      VALUES (?,?,?,'PROCESSING','scheduled_week_completion',?,?)`)
      .bind(SCOPE, request.idempotencyKey, hash, now, now),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT ${authSql}`)
      .bind(request.locationId, permitted.value.authUserId, capability),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
      SELECT 1 FROM delivery_cycle c JOIN fulfillment_location l ON l.market_id=c.market_id
      WHERE c.id=? AND l.id=? AND c.version=? AND c.status=? AND c.cutoff_at=? AND c.cutoff_at+?<=?)`)
      .bind(
        request.cycleId,
        request.locationId,
        cycle.cycleVersion,
        cycle.status,
        cycle.cutoffAt,
        SETTLEMENT_MS,
        now,
      ),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
      SELECT 1 FROM (${summarySql}) WHERE lines=? AND orders=? AND quantity=?)`)
      .bind(request.cycleId, request.locationId, demand.lines, demand.orders, demand.quantity),
  ];
  if (request.action === "PURCHASE_COMPLETE") {
    statements.push(
      deps.db
        .prepare(`INSERT INTO scheduled_week_completion
        (cycle_id,location_id,version,demand_line_count,paid_order_count,total_quantity_base,purchase_completed_at,purchase_actor_user_id)
        VALUES (?,?,1,?,?,?,?,?)`)
        .bind(
          request.cycleId,
          request.locationId,
          demand.lines,
          demand.orders,
          demand.quantity,
          now,
          permitted.value.authUserId,
        ),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -45 WHERE changes()<>1"),
    );
  } else {
    statements.push(
      deps.db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
        SELECT 1 FROM scheduled_week_completion WHERE cycle_id=? AND location_id=? AND version=?
          AND packed_at IS NULL AND demand_line_count=? AND paid_order_count=? AND total_quantity_base=?)`)
        .bind(
          request.cycleId,
          request.locationId,
          completion!.version,
          demand.lines,
          demand.orders,
          demand.quantity,
        ),
      deps.db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE EXISTS(
        SELECT 1 FROM grocery_order o JOIN fulfillment_record f ON f.order_id=o.id
        WHERE o.cycle_id=? AND f.location_id=? AND o.fulfillment_mode='SCHEDULED'
          AND EXISTS(SELECT 1 FROM committed_demand d WHERE d.order_id=o.id AND d.delivery_cycle_id=?
            AND d.location_id=? AND d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE')
          AND NOT ((o.status IN ('COMMITTED','FULFILLMENT_PENDING') AND f.status IN
            ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING'))
            OR (o.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY','DELIVERED') AND f.status='PACKED')))`)
        .bind(request.cycleId, request.locationId, request.cycleId, request.locationId),
      deps.db
        .prepare(`INSERT INTO audit_event
        (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,after_json,reason,location_id,correlation_id,occurred_at)
        SELECT lower(hex(randomblob(16))),?,'OPERATIONS.SCHEDULED_ORDER_PACKED','grocery_order',o.id,'{}',?,
          '{"status":"FULFILLMENT_READY"}','Physical packing completed outside FreshMarkets',?, ?, ?
        FROM grocery_order o JOIN fulfillment_record f ON f.order_id=o.id
        WHERE o.cycle_id=? AND f.location_id=? AND o.status IN ('COMMITTED','FULFILLMENT_PENDING')
          AND f.status IN ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING')
          AND EXISTS(SELECT 1 FROM committed_demand d WHERE d.order_id=o.id AND d.delivery_cycle_id=?
            AND d.location_id=? AND d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE')`)
        .bind(
          permitted.value.authUserId,
          request.idempotencyKey,
          request.locationId,
          request.requestId,
          now,
          request.cycleId,
          request.locationId,
          request.cycleId,
          request.locationId,
        ),
      deps.db
        .prepare(`UPDATE fulfillment_record SET status='PACKED',version=version+1,updated_at=?
        WHERE location_id=? AND status IN ('NOT_STARTED','PICKING','READY_TO_PACK','PACKING')
          AND EXISTS(SELECT 1 FROM grocery_order o WHERE o.id=fulfillment_record.order_id
            AND o.cycle_id=? AND o.fulfillment_mode='SCHEDULED' AND o.status IN ('COMMITTED','FULFILLMENT_PENDING'))
          AND EXISTS(SELECT 1 FROM committed_demand d WHERE d.order_id=fulfillment_record.order_id
            AND d.delivery_cycle_id=? AND d.location_id=? AND d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE')`)
        .bind(now, request.locationId, request.cycleId, request.cycleId, request.locationId),
      deps.db
        .prepare(`UPDATE grocery_order SET status='FULFILLMENT_READY',version=version+1
        WHERE cycle_id=? AND fulfillment_mode='SCHEDULED' AND status IN ('COMMITTED','FULFILLMENT_PENDING')
          AND EXISTS(SELECT 1 FROM fulfillment_record f WHERE f.order_id=grocery_order.id AND f.location_id=? AND f.status='PACKED')
          AND EXISTS(SELECT 1 FROM committed_demand d WHERE d.order_id=grocery_order.id AND d.delivery_cycle_id=?
            AND d.location_id=? AND d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE')`)
        .bind(request.cycleId, request.locationId, request.cycleId, request.locationId),
      deps.db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE
        (SELECT COUNT(DISTINCT d.order_id) FROM committed_demand d JOIN grocery_order o ON o.id=d.order_id
          JOIN fulfillment_record f ON f.order_id=o.id WHERE d.delivery_cycle_id=? AND d.location_id=?
          AND d.status='OPEN' AND d.demand_basis='EXACT_PAID_LINE' AND f.status='PACKED'
          AND o.status IN ('FULFILLMENT_READY','OUT_FOR_DELIVERY','DELIVERED'))<>?`)
        .bind(request.cycleId, request.locationId, demand.orders),
      deps.db
        .prepare(`UPDATE scheduled_week_completion SET packed_at=?,packing_actor_user_id=?,version=version+1
        WHERE cycle_id=? AND location_id=? AND version=? AND packed_at IS NULL`)
        .bind(
          now,
          permitted.value.authUserId,
          request.cycleId,
          request.locationId,
          completion!.version,
        ),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -45 WHERE changes()<>1"),
    );
  }
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: permitted.value.authUserId,
      action:
        request.action === "PURCHASE_COMPLETE"
          ? "OPERATIONS.SCHEDULED_PURCHASE_COMPLETE"
          : "OPERATIONS.SCHEDULED_PACKING_COMPLETE",
      resourceType: "scheduled_week_completion",
      resourceId: `${request.cycleId}:${request.locationId}`,
      locationId: request.locationId,
      reason:
        request.action === "PURCHASE_COMPLETE"
          ? "Physical purchase completed outside FreshMarkets"
          : "Physical packing completed outside FreshMarkets",
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
      after: result,
    }),
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -45 WHERE changes()<>1"),
    deps.db
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
      .bind(JSON.stringify(result), now, SCOPE, request.idempotencyKey, hash),
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -45 WHERE changes()<>1"),
  );
  try {
    await deps.db.batch(statements);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return failure(
        "STALE_VERSION",
        "Week, paid demand, or access changed; refresh and retry",
        request.requestId,
      );
    throw error;
  }
  return { ok: true, value: result, requestId: request.requestId };
}
