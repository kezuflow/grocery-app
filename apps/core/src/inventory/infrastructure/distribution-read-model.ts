import type { InventoryDistributionPage } from "@freshmarkets/contracts";

/** Derived per-pool quantities. Damaged/missing are subsets of transit, never extra balances. */
export async function readInventoryDistribution(
  db: D1Database,
  input: { query?: string; cursor?: string; limit: number },
) {
  const result = await db
    .prepare(`WITH selected AS (
    SELECT pool.id inventoryPoolId,p.name productName,u.canonical_base_code baseUnit
    FROM inventory_pool pool JOIN product p ON p.inventory_pool_id=pool.id JOIN unit u ON u.id=pool.base_unit_id
    WHERE u.canonical_base_code IN ('GRAM','PIECE') AND instr(lower(p.name),lower(?))>0 AND pool.id>?
    ORDER BY pool.id LIMIT ?
  ) SELECT selected.*,
    COALESCE((SELECT SUM(b.on_hand) FROM inventory_balance b JOIN fulfillment_location l ON l.id=b.location_id WHERE b.inventory_pool_id=selected.inventoryPoolId AND l.purpose='CENTRAL_WAREHOUSE'),0) centralBase,
    COALESCE((SELECT SUM(b.on_hand) FROM inventory_balance b JOIN fulfillment_location l ON l.id=b.location_id WHERE b.inventory_pool_id=selected.inventoryPoolId AND l.purpose='CUSTOMER_FULFILLMENT'),0) localBase,
    COALESCE((SELECT SUM(b.on_hand) FROM inventory_balance b WHERE b.inventory_pool_id=selected.inventoryPoolId),0) physicalBase,
    COALESCE((SELECT SUM(b.reserved) FROM inventory_balance b WHERE b.inventory_pool_id=selected.inventoryPoolId),0) reservedBase,
    COALESCE((SELECT SUM(h.quantity) FROM checkout_inventory_holds h WHERE h.inventory_pool_id=selected.inventoryPoolId AND h.status='HELD'),0) heldBase,
    COALESCE((SELECT SUM(line.quantity_base-line.accepted_base-line.lost_base-line.returned_base) FROM inventory_transfer_line line JOIN inventory_transfer t ON t.id=line.transfer_id WHERE line.inventory_pool_id=selected.inventoryPoolId AND t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')),0) transitBase,
    COALESCE((SELECT SUM(line.damaged_base) FROM inventory_transfer_line line JOIN inventory_transfer t ON t.id=line.transfer_id WHERE line.inventory_pool_id=selected.inventoryPoolId AND t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')),0) damagedBase,
    COALESCE((SELECT SUM(line.shortage_base) FROM inventory_transfer_line line JOIN inventory_transfer t ON t.id=line.transfer_id WHERE line.inventory_pool_id=selected.inventoryPoolId AND t.status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')),0) shortageBase
    FROM selected ORDER BY inventoryPoolId`)
    .bind(input.query ?? "", input.cursor ?? "", input.limit)
    .all<InventoryDistributionPage["items"][number]>();
  return result.results;
}
