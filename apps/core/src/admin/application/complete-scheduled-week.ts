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

const SCOPE = "scheduledWeek.purchaseComplete";
type DemandSummary = { lines: number; orders: number; quantity: number };
const summarySql = `SELECT COUNT(*) lines,COUNT(DISTINCT order_id) orders,
  COALESCE(SUM(quantity_base_total),0) quantity FROM committed_demand
  WHERE delivery_cycle_id=? AND location_id=? AND status='OPEN' AND demand_basis='EXACT_PAID_LINE'`;

function failure(
  code: "NOT_FOUND" | "ILLEGAL_TRANSITION" | "STALE_VERSION" | "CONFLICT" | "IDEMPOTENCY_CONFLICT",
  message: string,
  requestId: string,
): RpcResult<ScheduledWeekCompletionView> {
  return { ok: false, error: { code, message, requestId } };
}

/** Record physical purchase against one location's frozen paid-demand snapshot. */
export async function completeScheduledWeek(
  deps: OperationsAdministrationDeps,
  request: ScheduledWeekCompletionRequest,
): Promise<RpcResult<ScheduledWeekCompletionView>> {
  const permitted = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "procurement.manage",
    request.locationId,
  );
  if (!permitted.ok) return permitted;
  const hash = await requestHash({
    cycleId: request.cycleId,
    locationId: request.locationId,
    expectedVersion: request.expectedVersion,
    actor: permitted.value.authUserId,
  });
  async function replay(): Promise<RpcResult<ScheduledWeekCompletionView> | null> {
    const saved = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key was used for a different purchase",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.resultReference)
      return {
        ok: true,
        value: JSON.parse(saved.resultReference) as ScheduledWeekCompletionView,
        requestId: request.requestId,
      };
    return failure(
      "CONFLICT",
      "The original purchase action needs reconciliation",
      request.requestId,
    );
  }
  const prior = await replay();
  if (prior) return prior;

  const cycle = await deps.db
    .prepare(`SELECT c.status,c.cutoff_at cutoffAt,c.version cycleVersion,s.procurement_at procurementAt
    FROM delivery_cycle c JOIN fulfillment_location l ON l.market_id=c.market_id
    JOIN delivery_cycle_schedule s ON s.cycle_id=c.id WHERE c.id=? AND l.id=?`)
    .bind(request.cycleId, request.locationId)
    .first<{ status: string; cutoffAt: number; cycleVersion: number; procurementAt: number }>();
  if (!cycle)
    return failure("NOT_FOUND", "Delivery week was not found at this location", request.requestId);
  const now = Date.now();
  if (
    cycle.procurementAt < cycle.cutoffAt ||
    cycle.procurementAt > now ||
    !["OPEN", "CUTOFF_REACHED"].includes(cycle.status)
  )
    return failure(
      "ILLEGAL_TRANSITION",
      "Wait until the configured procurement start time",
      request.requestId,
    );
  if (request.expectedVersion !== 0)
    return failure(
      "STALE_VERSION",
      "This week changed; refresh before continuing",
      request.requestId,
    );
  const demand = await deps.db
    .prepare(summarySql)
    .bind(request.cycleId, request.locationId)
    .first<DemandSummary>();
  if (!demand || demand.lines < 1 || demand.orders < 1 || demand.quantity < 1)
    return failure(
      "ILLEGAL_TRANSITION",
      "No paid orders are ready for this week",
      request.requestId,
    );
  const result: ScheduledWeekCompletionView = {
    cycleId: request.cycleId,
    locationId: request.locationId,
    version: 1,
    paidOrderCount: demand.orders,
    purchaseCompletedAt: now,
  };
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
      VALUES (?,?,?,'PROCESSING','scheduled_week_completion',?,?)`)
      .bind(SCOPE, request.idempotencyKey, hash, now, now),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
      SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
      JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
      JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location l ON l.id=?
      WHERE staff.auth_user_id=? AND staff.status='active' AND p.code='procurement.manage'
        AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=l.market_id)
          OR (scope.scope_kind='location' AND scope.location_id=l.id)))`)
      .bind(request.locationId, permitted.value.authUserId),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
      SELECT 1 FROM delivery_cycle c JOIN fulfillment_location l ON l.market_id=c.market_id
      JOIN delivery_cycle_schedule s ON s.cycle_id=c.id
      WHERE c.id=? AND l.id=? AND c.version=? AND c.status=? AND c.cutoff_at=?
        AND s.procurement_at=? AND s.procurement_at>=c.cutoff_at
        AND s.procurement_at<=CAST(unixepoch('subsec')*1000 AS INTEGER))`)
      .bind(
        request.cycleId,
        request.locationId,
        cycle.cycleVersion,
        cycle.status,
        cycle.cutoffAt,
        cycle.procurementAt,
      ),
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -45 WHERE NOT EXISTS(
      SELECT 1 FROM (${summarySql}) WHERE lines=? AND orders=? AND quantity=?)`)
      .bind(request.cycleId, request.locationId, demand.lines, demand.orders, demand.quantity),
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
    auditEventStatement(deps.db, {
      actorUserId: permitted.value.authUserId,
      action: "OPERATIONS.SCHEDULED_PURCHASE_COMPLETE",
      resourceType: "scheduled_week_completion",
      resourceId: `${request.cycleId}:${request.locationId}`,
      locationId: request.locationId,
      reason: "Physical purchase completed outside FreshMarkets",
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
  ];
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
        "Week, paid demand, or access changed; refresh",
        request.requestId,
      );
    throw error;
  }
  return { ok: true, value: result, requestId: request.requestId };
}
