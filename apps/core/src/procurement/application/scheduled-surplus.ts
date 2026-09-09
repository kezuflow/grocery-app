import type {
  ReleaseScheduledSurplusRequest,
  ScheduledSurplusReleaseView,
  ScheduledSurplusView,
  RpcResult,
  AppErrorCode,
} from "@freshmarkets/contracts";
import {
  releaseScheduledSurplusBodySchema,
  scheduledSurplusReleaseViewSchema,
  scheduledSurplusViewSchema,
  idempotencyKeySchema,
} from "@freshmarkets/validation";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";

// Correlated to the cycle balance b. Unpacked paid demand remains allocated even when its
// fulfillment record is missing or in exception. Packing movements are immutable evidence.
const outstanding = `(SELECT COALESCE(SUM(d.quantity),0) FROM committed_demand d
 WHERE d.delivery_cycle_id=b.cycle_id AND d.location_id=b.location_id AND d.inventory_pool_id=b.inventory_pool_id
 AND d.status='OPEN' AND NOT EXISTS(SELECT 1 FROM cycle_goods_movement m
 WHERE m.order_id=d.order_id AND m.inventory_pool_id=d.inventory_pool_id AND m.movement_type='PACKING'))`;
const unused = `(b.received_base-b.packed_base-b.surplus_released_base-b.disposed_base-${outstanding})`;
// A paid commitment can arrive after cutoff. Keep goods allocated until its owning
// Payments operation is committed or definitively closed; an expired browser quote is insufficient.
const unresolved = `EXISTS(SELECT 1 FROM payment_intent payment WHERE (
 (payment.subject_type='checkout_quote' AND EXISTS(SELECT 1 FROM checkout_quote q WHERE q.id=payment.subject_id AND q.delivery_cycle_id=b.cycle_id)
  AND NOT EXISTS(SELECT 1 FROM order_payment_reaction link WHERE link.payment_intent_id=payment.id))
 OR (payment.subject_type='paid_order_amendment' AND EXISTS(SELECT 1 FROM paid_order_amendment a JOIN grocery_order o ON o.id=a.order_id
   WHERE a.id=payment.subject_id AND o.cycle_id=b.cycle_id AND a.status<>'COMMITTED'))
 ) AND (
 payment.status NOT IN ('FAILED','EXPIRED','REFUNDED')
 OR EXISTS(SELECT 1 FROM payment_attempt attempt WHERE attempt.payment_intent_id=payment.id AND attempt.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED') AND payment.status<>'REFUNDED')
 OR EXISTS(SELECT 1 FROM payment_creation_observation creation WHERE creation.payment_intent_id=payment.id AND creation.applied_at IS NULL)
 OR EXISTS(SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=payment.id AND reaction.status IN ('PENDING','ESCALATED'))
 OR EXISTS(SELECT 1 FROM payment_provider_event_inbox inbox JOIN payment_attempt attempt ON attempt.provider=inbox.provider AND attempt.provider_reference=inbox.provider_reference
   WHERE attempt.payment_intent_id=payment.id AND inbox.processing_status IN ('RECEIVED','RETRY_REQUIRED','RECONCILIATION_REQUIRED'))
 ))`;
const blocked = `CASE WHEN c.cutoff_at>CAST(unixepoch('subsec')*1000 AS INTEGER) THEN 'Ordering has not closed for this week.'
 WHEN ${unresolved} THEN 'Payments for this week still need reconciliation.' ELSE NULL END`;

/** Bounded to the requirements on the already-authorized receiving page; one row per balance. */
export async function listScheduledSurplus(
  db: D1Database,
  locationId: string,
  requirementIds: readonly string[],
): Promise<ScheduledSurplusView[]> {
  if (!requirementIds.length) return [];
  const rows = await db
    .prepare(`SELECT b.cycle_id cycleId,c.name cycleName,b.location_id locationId,b.inventory_pool_id inventoryPoolId,
    COALESCE((SELECT p.name || CASE WHEN p.stock_tracking='COUNTED_SIZES' THEN ' · '||s.name ELSE '' END
      FROM sku s JOIN product p ON p.id=s.product_id WHERE COALESCE(s.stock_pool_id,p.inventory_pool_id)=b.inventory_pool_id ORDER BY s.id LIMIT 1),
      (SELECT p.name FROM product p WHERE p.inventory_pool_id=b.inventory_pool_id ORDER BY p.id LIMIT 1),'Retained goods') productName,
    u.symbol unit,MAX(0,${unused}) availableBase,b.surplus_released_base releasedBase,b.version,${blocked} blockedReason
    FROM cycle_goods_balance b JOIN delivery_cycle c ON c.id=b.cycle_id JOIN inventory_pool pool ON pool.id=b.inventory_pool_id JOIN unit u ON u.id=pool.base_unit_id
    WHERE b.location_id=? AND EXISTS(SELECT 1 FROM procurement_requirement pr WHERE pr.id IN (SELECT value FROM json_each(?))
      AND pr.delivery_cycle_id=b.cycle_id AND pr.location_id=b.location_id AND pr.inventory_pool_id=b.inventory_pool_id)
    ORDER BY b.cycle_id,b.inventory_pool_id LIMIT 100`)
    .bind(locationId, JSON.stringify(requirementIds))
    .all<ScheduledSurplusView>();
  return rows.results.map((row) => scheduledSurplusViewSchema.parse(row));
}

/** One inspected cycle debit and physical credit, with all conservation/recovery evidence. */
export async function releaseScheduledSurplus(
  deps: OperationsAdministrationDeps,
  input: ReleaseScheduledSurplusRequest,
): Promise<RpcResult<ScheduledSurplusReleaseView>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<ScheduledSurplusReleaseView> => ({
    ok: false,
    error: { code, message, requestId: input.requestId },
  });
  const parsed = releaseScheduledSurplusBodySchema.strip().safeParse(input),
    key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success)
    return fail(
      "VALIDATION_FAILED",
      "Confirm inspection, quantity and reason for these unused goods",
    );
  const body = parsed.data,
    commandKey = key.data;
  const access = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "procurement.manage",
    body.locationId,
  );
  if (!access.ok) return access;
  const scope = "procurement.releaseSurplus",
    hash = await requestHash({ ...body, actor: access.value.authUserId });
  async function replay(): Promise<RpcResult<ScheduledSurplusReleaseView> | null> {
    const prior = await findIdempotencyRecord(deps.db, scope, commandKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to another surplus release");
    if (prior.status !== "SUCCEEDED") return null;
    if (!prior.resultReference)
      return fail("CONFLICT", "The original release result is unavailable");
    return {
      ok: true,
      value: scheduledSurplusReleaseViewSchema.parse(JSON.parse(prior.resultReference)),
      requestId: input.requestId,
    };
  }
  const prior = await replay();
  if (prior) return prior;
  const balance = await deps.db
    .prepare(`SELECT b.version,${unused} availableBase,${blocked} blockedReason
    FROM cycle_goods_balance b JOIN delivery_cycle c ON c.id=b.cycle_id WHERE b.cycle_id=? AND b.location_id=? AND b.inventory_pool_id=?`)
    .bind(body.cycleId, body.locationId, body.inventoryPoolId)
    .first<{ version: number; availableBase: number; blockedReason: string | null }>();
  if (!balance)
    return fail("NOT_FOUND", "Received goods were not found for this location and week");
  if (balance.version !== body.expectedVersion)
    return fail("STALE_VERSION", "These goods changed; refresh before releasing them");
  if (balance.blockedReason) return fail("CONFLICT", balance.blockedReason);
  if (balance.availableBase < body.quantityBase)
    return fail(
      "VALIDATION_FAILED",
      "Keep the goods needed for paid Orders allocated to this week",
    );
  const now = Date.now(),
    movementId = crypto.randomUUID();
  const value: ScheduledSurplusReleaseView = {
    movementId,
    quantityBase: body.quantityBase,
    version: body.expectedVersion + 1,
  };
  const guard = () =>
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()<>1");
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id AND p.code='procurement.manage'
      JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
      WHERE staff.auth_user_id=? AND staff.status='active' AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id) OR (scope.scope_kind='location' AND scope.location_id=location.id)))`)
      .bind(body.locationId, access.value.authUserId),
    deps.db
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','scheduled_surplus_release',?,?)
      ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='PROCESSING',updated_at=excluded.updated_at WHERE idempotency_records.request_hash=excluded.request_hash AND idempotency_records.status IN ('FAILED','PROCESSING')`)
      .bind(scope, commandKey, hash, now, now),
    guard(),
    deps.db
      .prepare(`UPDATE cycle_goods_balance AS b SET surplus_released_base=surplus_released_base+?,version=version+1,updated_at=?
      WHERE cycle_id=? AND location_id=? AND inventory_pool_id=? AND version=? AND version<9007199254740991 AND ${unused}>=?
      AND EXISTS(SELECT 1 FROM delivery_cycle c WHERE c.id=b.cycle_id AND c.cutoff_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)) AND NOT ${unresolved}`)
      .bind(
        body.quantityBase,
        now,
        body.cycleId,
        body.locationId,
        body.inventoryPoolId,
        body.expectedVersion,
        body.quantityBase,
      ),
    guard(),
    deps.db
      .prepare(`INSERT INTO cycle_goods_movement(id,cycle_id,location_id,inventory_pool_id,movement_type,quantity_base,actor_user_id,reason,idempotency_key,occurred_at)
      VALUES (?,?,?,?,'SURPLUS_RELEASE',?,?,?,?,?)`)
      .bind(
        movementId,
        body.cycleId,
        body.locationId,
        body.inventoryPoolId,
        body.quantityBase,
        access.value.authUserId,
        body.reason,
        commandKey,
        now,
      ),
    guard(),
    deps.db
      .prepare(`INSERT INTO inventory_balance(location_id,inventory_pool_id,on_hand,reserved,version) VALUES (?,?,?,0,1)
      ON CONFLICT(location_id,inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand,version=version+1 WHERE on_hand<=9007199254740991-excluded.on_hand AND version<9007199254740991`)
      .bind(body.locationId, body.inventoryPoolId, body.quantityBase),
    guard(),
    deps.db
      .prepare(`INSERT INTO inventory_ledger_entries(id,inventory_pool_id,location_id,movement_type,quantity_delta_base,reservation_delta_base,reference_type,reference_id,actor_type,actor_id,reason_code,metadata_json,created_at,idempotency_key)
      VALUES (?,?,?,'SURPLUS_RELEASE',?,0,'cycle_goods_movement',?,'STAFF',?,?,'{}',?,?)`)
      .bind(
        crypto.randomUUID(),
        body.inventoryPoolId,
        body.locationId,
        body.quantityBase,
        movementId,
        access.value.authUserId,
        body.reason,
        now,
        `surplus:${movementId}`,
      ),
    guard(),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "OPERATIONS.SURPLUS_RELEASED",
      resourceType: "cycle_goods_movement",
      resourceId: movementId,
      locationId: body.locationId,
      reason: body.reason,
      idempotencyKey: commandKey,
      correlationId: input.requestId,
      occurredAt: now,
      before: {
        cycleId: body.cycleId,
        inventoryPoolId: body.inventoryPoolId,
        version: body.expectedVersion,
      },
      after: { ...value, inspected: true },
    }),
    guard(),
    deps.db
      .prepare(
        `UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`,
      )
      .bind(JSON.stringify(value), now, scope, commandKey, hash),
    guard(),
  ];
  try {
    await deps.db.batch(statements);
  } catch (error) {
    const saved = await replay();
    if (saved) return saved;
    if (
      error instanceof Error &&
      /CHECK constraint failed|UNIQUE constraint failed/.test(error.message)
    )
      return fail("STALE_VERSION", "Goods, demand, payments or access changed; refresh and review");
    throw error;
  }
  return { ok: true, value, requestId: input.requestId };
}
