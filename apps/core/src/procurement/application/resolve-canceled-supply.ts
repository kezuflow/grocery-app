/** Compose with the owning Order cancellation after its demand-release statement.
 * Purchased exact-demand requirements have already passed payment readiness. Only
 * received cycle goods cover remaining demand; physical stock never participates.
 */
export function resolveCanceledSupplyStatements(
  db: D1Database,
  input: {
    orderId: string;
    cancellationId: string;
    actorUserId: string | null;
    reason: string;
    requestId: string;
    occurredAt: number;
  },
): D1PreparedStatement[] {
  const resolution = `ORDER_CANCELLATION:${input.cancellationId}`;
  const eligible = `SELECT se.id FROM supply_exception se
    JOIN procurement_requirement pr ON pr.id=se.requirement_id
    JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id
    LEFT JOIN cycle_goods_balance b ON b.cycle_id=pr.delivery_cycle_id AND b.location_id=pr.location_id AND b.inventory_pool_id=pr.inventory_pool_id
    WHERE se.status='OPEN' AND substr(se.id,1,length('receipt:'||rr.id||':'))='receipt:'||rr.id||':'
    AND pr.calculation_basis='EXACT_PAID_DEMAND' AND rr.legacy_accepted_base=0
    AND rr.accepted_quantity+rr.rejected_quantity+rr.shortage_base-rr.replacement_base=rr.expected_quantity
    AND EXISTS(SELECT 1 FROM order_cancellation c JOIN grocery_order o ON o.id=c.order_id
      WHERE c.id=? AND c.order_id=? AND c.actor_type!='STAFF_EXCEPTION' AND o.fulfillment_mode='SCHEDULED')
    AND EXISTS(SELECT 1 FROM committed_demand released WHERE released.order_id=? AND released.status='CANCELED'
      AND released.delivery_cycle_id=pr.delivery_cycle_id AND released.location_id=pr.location_id AND released.inventory_pool_id=pr.inventory_pool_id)
    AND COALESCE(b.received_base-b.packed_base-b.surplus_released_base-b.disposed_base,0)>=(
      SELECT COALESCE(SUM(d.quantity),0) FROM committed_demand d WHERE d.status='OPEN'
      AND d.delivery_cycle_id=pr.delivery_cycle_id AND d.location_id=pr.location_id AND d.inventory_pool_id=pr.inventory_pool_id
      AND NOT EXISTS(SELECT 1 FROM cycle_goods_movement m WHERE m.order_id=d.order_id AND m.inventory_pool_id=d.inventory_pool_id AND m.movement_type='PACKING'))`;
  const binds = [input.cancellationId, input.orderId, input.orderId];
  return [
    db
      .prepare(
        `UPDATE supply_exception SET status='RESOLVED',resolution=?,version=version+1 WHERE id IN (${eligible})`,
      )
      .bind(resolution, ...binds),
    // An ignored update must abort the complete cancellation, not leave an unrecorded resolution.
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE EXISTS(${eligible})`)
      .bind(...binds),
    db
      .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,before_json,after_json,reason,location_id,correlation_id,occurred_at)
      SELECT 'supply-cancel:'||se.id,?,'PROCUREMENT.EXCEPTION_RESOLVED','supply_exception',se.id,
      json_object('orderId',?,'cancellationId',?,'requirementId',se.requirement_id,'affectedQuantity',se.affected_quantity),
      'supply-cancel:'||se.id,json_object('status','OPEN','version',se.version-1),json_object('status','RESOLVED','version',se.version,'resolution',se.resolution),?,pr.location_id,?,?
      FROM supply_exception se JOIN procurement_requirement pr ON pr.id=se.requirement_id
      WHERE se.status='RESOLVED' AND se.resolution=? AND NOT EXISTS(SELECT 1 FROM audit_event a WHERE a.id='supply-cancel:'||se.id)`)
      .bind(
        input.actorUserId,
        input.orderId,
        input.cancellationId,
        input.reason,
        input.requestId,
        input.occurredAt,
        resolution,
      ),
    db
      .prepare(`INSERT INTO commitment_abort(id) SELECT -36 WHERE EXISTS(SELECT 1 FROM supply_exception se
      WHERE se.status='RESOLVED' AND se.resolution=? AND NOT EXISTS(SELECT 1 FROM audit_event a WHERE a.id='supply-cancel:'||se.id
        AND a.action='PROCUREMENT.EXCEPTION_RESOLVED' AND a.aggregate_id=se.id AND json_extract(a.details_json,'$.cancellationId')=?))`)
      .bind(resolution, input.cancellationId),
  ];
}
