/** Read-only guidance; the packing command still checks these facts inside its transaction. */
export async function scheduledPackingGoodsReadyOrderIds(
  database: D1Database,
  orders: readonly { orderId: string; cycleId: string | null; locationId: string }[],
): Promise<Set<string>> {
  if (orders.length === 0) return new Set();
  const rows = await database
    .prepare(`WITH wanted AS (
      SELECT json_extract(value,'$.orderId') order_id,
        json_extract(value,'$.cycleId') cycle_id,
        json_extract(value,'$.locationId') location_id
      FROM json_each(?)
    ), needed AS (
      SELECT d.order_id,d.inventory_pool_id,SUM(d.quantity) quantity
      FROM committed_demand d JOIN wanted w ON w.order_id=d.order_id
      GROUP BY d.order_id,d.inventory_pool_id
    )
    SELECT w.order_id FROM wanted w WHERE
      EXISTS (SELECT 1 FROM needed n WHERE n.order_id=w.order_id)
      AND NOT EXISTS (SELECT 1 FROM committed_demand d WHERE d.order_id=w.order_id AND
        (d.status<>'OPEN' OR d.demand_basis<>'EXACT_PAID_LINE' OR d.delivery_cycle_id IS NOT w.cycle_id OR d.location_id<>w.location_id))
      AND NOT EXISTS (SELECT 1 FROM needed n LEFT JOIN cycle_goods_balance b
        ON b.cycle_id=w.cycle_id AND b.location_id=w.location_id AND b.inventory_pool_id=n.inventory_pool_id
        WHERE n.order_id=w.order_id AND
          (n.quantity<=0 OR b.received_base IS NULL OR
           b.received_base-b.packed_base-b.surplus_released_base-b.disposed_base<n.quantity))`)
    .bind(JSON.stringify(orders))
    .all<{ order_id: string }>();
  return new Set(rows.results.map((row) => row.order_id));
}

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
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -37 WHERE changes()<>(SELECT COUNT(DISTINCT inventory_pool_id) FROM committed_demand WHERE order_id=?)",
      )
      .bind(orderId),
    database
      .prepare(`UPDATE cycle_goods_balance SET packed_base=packed_base+
      (SELECT SUM(quantity) FROM committed_demand d WHERE d.order_id=? AND d.inventory_pool_id=cycle_goods_balance.inventory_pool_id),
      version=version+1,updated_at=? WHERE cycle_id=? AND location_id=? AND inventory_pool_id IN
      (SELECT inventory_pool_id FROM committed_demand WHERE order_id=?)`)
      .bind(orderId, now, cycleId, locationId, orderId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -37 WHERE changes()<>(SELECT COUNT(DISTINCT inventory_pool_id) FROM committed_demand WHERE order_id=?)",
      )
      .bind(orderId),
  ];
}
