type SizeCount = { skuId: string; quantity: number };
type SortingInput = {
  productId: string;
  locationId: string;
  quantityGrams: number;
  sizeCounts: readonly SizeCount[];
  actorUserId: string;
  reason: string;
  effectKey: string;
  now: number;
  expectedVersion?: number;
  receiptEffectKey?: string;
};

const required = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()<>1");

/** Consume measured bulk once and credit only the staff's actual counts in the caller's batch. */
export async function stockSortingStatements(db: D1Database, input: SortingInput) {
  const product = await db
    .prepare(`SELECT p.inventory_pool_id poolId FROM product p
    JOIN inventory_pool pool ON pool.id=p.inventory_pool_id JOIN unit u ON u.id=pool.base_unit_id
    WHERE p.id=? AND p.stock_tracking='COUNTED_SIZES' AND u.code='GRAM'`)
    .bind(input.productId)
    .first<{ poolId: string }>();
  if (!product) return null;
  const sizes = await db
    .prepare(`SELECT s.id skuId,s.stock_pool_id poolId,s.name FROM sku s
    JOIN inventory_pool pool ON pool.id=s.stock_pool_id JOIN unit u ON u.id=pool.base_unit_id
    WHERE s.product_id=? AND s.status='active' AND u.code='PIECE' AND s.consumption_base_quantity=1`)
    .bind(input.productId)
    .all<{ skuId: string; poolId: string; name: string }>();
  const byId = new Map(sizes.results.map((size) => [size.skuId, size]));
  if (input.sizeCounts.some((size) => !byId.has(size.skuId))) return null;
  const sortId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM product WHERE id=? AND stock_tracking='COUNTED_SIZES' AND inventory_pool_id=?)`)
      .bind(input.productId, product.poolId),
    db
      .prepare(`UPDATE inventory_balance SET on_hand=on_hand-?,version=version+1
      WHERE location_id=? AND inventory_pool_id=? AND version<9007199254740991
      AND (? IS NULL OR version=?) AND on_hand-reserved-?>=COALESCE((SELECT SUM(quantity)
        FROM checkout_inventory_holds WHERE location_id=? AND inventory_pool_id=? AND status='HELD'),0)`)
      .bind(
        input.quantityGrams,
        input.locationId,
        product.poolId,
        input.expectedVersion ?? null,
        input.expectedVersion ?? null,
        input.quantityGrams,
        input.locationId,
        product.poolId,
      ),
    required(db),
    db
      .prepare(`INSERT INTO inventory_sort(id,location_id,product_id,source_pool_id,quantity_grams,
      transfer_receipt_id,actor_user_id,reason,created_at,effect_key)
      SELECT ?,?,?,?,?, (SELECT id FROM inventory_transfer_receipt WHERE effect_key=?),?,?,?,?
      WHERE ? IS NULL OR EXISTS(SELECT 1 FROM inventory_transfer_receipt r
        JOIN inventory_transfer t ON t.id=r.transfer_id JOIN inventory_transfer_line l ON l.id=r.line_id
        WHERE r.effect_key=? AND r.accepted_base=? AND t.destination_location_id=? AND l.inventory_pool_id=?)`)
      .bind(
        sortId,
        input.locationId,
        input.productId,
        product.poolId,
        input.quantityGrams,
        input.receiptEffectKey ?? null,
        input.actorUserId,
        input.reason,
        input.now,
        input.effectKey,
        input.receiptEffectKey ?? null,
        input.receiptEffectKey ?? null,
        input.quantityGrams,
        input.locationId,
        product.poolId,
      ),
    required(db),
  ];
  function ledger(poolId: string, delta: number, suffix: string) {
    return db
      .prepare(`INSERT INTO inventory_ledger_entries(id,inventory_pool_id,location_id,movement_type,
      quantity_delta_base,reservation_delta_base,reference_type,reference_id,actor_type,actor_id,reason_code,metadata_json,created_at,idempotency_key)
      VALUES (?,?,?,'STOCK_SORT',?,0,'inventory_sort',?,'STAFF',?,?,'{}',?,?)`)
      .bind(
        crypto.randomUUID(),
        poolId,
        input.locationId,
        delta,
        sortId,
        input.actorUserId,
        input.reason,
        input.now,
        `${input.effectKey}:${suffix}`,
      );
  }
  statements.push(ledger(product.poolId, -input.quantityGrams, "bulk"), required(db));
  for (const count of input.sizeCounts) {
    const size = byId.get(count.skuId);
    if (!size) return null;
    statements.push(
      db
        .prepare(`INSERT INTO inventory_sort_output(sort_id,sku_id,inventory_pool_id,quantity_pieces,sku_name)
        SELECT ?,id,stock_pool_id,?,name FROM sku WHERE id=? AND product_id=? AND stock_pool_id=? AND status='active' AND consumption_base_quantity=1`)
        .bind(sortId, count.quantity, size.skuId, input.productId, size.poolId),
      required(db),
      db
        .prepare(`INSERT INTO inventory_balance(location_id,inventory_pool_id,on_hand,reserved,version) VALUES (?,?,?,0,1)
        ON CONFLICT(location_id,inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand,version=version+1
        WHERE on_hand<=9007199254740991-excluded.on_hand AND version<9007199254740991`)
        .bind(input.locationId, size.poolId, count.quantity),
      required(db),
      ledger(size.poolId, count.quantity, size.skuId),
      required(db),
    );
  }
  return { sortId, statements };
}
