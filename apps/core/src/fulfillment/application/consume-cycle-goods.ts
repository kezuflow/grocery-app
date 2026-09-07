/** Statements join the fulfillment command's guarded transaction, including its Order lock. */
export function consumeCycleGoodsStatements(
  database: D1Database,
  input: {
    orderId: string;
    cycleId: string | null;
    locationId: string;
    actorUserId: string | null;
    now: number;
  },
): D1PreparedStatement[] {
  const { orderId, cycleId, locationId, actorUserId, now } = input;
  return [
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -37 WHERE
      NOT EXISTS (SELECT 1 FROM committed_demand WHERE order_id=?)
      OR EXISTS (SELECT 1 FROM committed_demand WHERE order_id=? AND
        (status<>'OPEN' OR demand_basis<>'EXACT_PAID_LINE' OR delivery_cycle_id IS NOT ? OR location_id<>?))
      OR EXISTS (SELECT 1 FROM order_item line WHERE line.order_id=? AND NOT EXISTS
        (SELECT 1 FROM committed_demand d WHERE d.order_item_id=line.id AND d.order_id=line.order_id AND d.quantity=line.base_quantity))
      OR EXISTS (SELECT 1 FROM paid_order_amendment_line line JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
        WHERE amendment.order_id=? AND amendment.status='COMMITTED' AND NOT EXISTS
          (SELECT 1 FROM committed_demand d WHERE d.amendment_line_id=line.id AND d.order_id=amendment.order_id AND d.quantity=line.base_quantity))`)
      .bind(orderId, orderId, cycleId, locationId, orderId, orderId),
    database
      .prepare(`WITH needed AS (SELECT inventory_pool_id,SUM(quantity) quantity FROM committed_demand WHERE order_id=? GROUP BY inventory_pool_id)
      INSERT INTO commitment_abort(id) SELECT -37 WHERE EXISTS (
        SELECT 1 FROM needed n LEFT JOIN cycle_goods_balance b ON b.cycle_id=? AND b.location_id=? AND b.inventory_pool_id=n.inventory_pool_id
        WHERE b.received_base IS NULL OR n.quantity<=0 OR b.received_base-b.packed_base-b.surplus_released_base-b.disposed_base<n.quantity)`)
      .bind(orderId, cycleId, locationId),
    database
      .prepare(`INSERT INTO cycle_goods_movement(id,cycle_id,location_id,inventory_pool_id,movement_type,quantity_base,order_id,actor_user_id,idempotency_key,occurred_at)
      SELECT 'cycle-pack:'||?||':'||inventory_pool_id,?,?,inventory_pool_id,'PACKING',SUM(quantity),?,?,'cycle-pack:'||?||':'||inventory_pool_id,?
      FROM committed_demand WHERE order_id=? GROUP BY inventory_pool_id`)
      .bind(orderId, cycleId, locationId, orderId, actorUserId, orderId, now, orderId),
    database
      .prepare(`UPDATE cycle_goods_balance SET packed_base=packed_base+
      (SELECT SUM(quantity) FROM committed_demand d WHERE d.order_id=? AND d.inventory_pool_id=cycle_goods_balance.inventory_pool_id),
      version=version+1,updated_at=? WHERE cycle_id=? AND location_id=? AND inventory_pool_id IN
      (SELECT inventory_pool_id FROM committed_demand WHERE order_id=?)`)
      .bind(orderId, now, cycleId, locationId, orderId),
  ];
}
