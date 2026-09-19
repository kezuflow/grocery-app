export type InstantInventoryDemand = Readonly<{
  inventoryPoolId: string;
  requiredQuantity: number;
  usableQuantity: number;
}>;

type DemandRow = {
  inventory_pool_id: string;
  required_quantity: number;
  usable_quantity: number;
};

/**
 * Returns whole-cart Instant demand aggregated by physical stock pool. Holds
 * belonging to this cart are excluded only while they remain replaceable: a
 * started or successful payment keeps its hold protected and consuming stock.
 */
export async function loadInstantInventoryAvailability(
  database: D1Database,
  input: { cartId: string; locationId: string },
): Promise<readonly InstantInventoryDemand[]> {
  const rows = await database
    .prepare(
      `WITH demand AS (
         SELECT COALESCE(s.stock_pool_id,p.inventory_pool_id) AS inventory_pool_id,
                SUM(ci.quantity*s.consumption_base_quantity) AS required_quantity
         FROM cart_item ci
         JOIN sku s ON s.id=ci.sku_id
         JOIN product p ON p.id=s.product_id
         WHERE ci.cart_id=?
         GROUP BY COALESCE(s.stock_pool_id,p.inventory_pool_id)
       )
       SELECT demand.inventory_pool_id,demand.required_quantity,
              COALESCE(balance.on_hand-balance.reserved,0)-COALESCE((
                SELECT SUM(hold.quantity)
                FROM checkout_inventory_holds hold
                WHERE hold.location_id=?
                  AND hold.inventory_pool_id=demand.inventory_pool_id
                  AND hold.status='HELD'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM checkout_quote quote
                    WHERE quote.id=hold.checkout_attempt_id
                      AND quote.cart_id=?
                      AND NOT EXISTS (
                        SELECT 1
                        FROM payment_intent payment
                        WHERE payment.subject_type='checkout_quote'
                          AND payment.subject_id=quote.id
                          AND payment.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
                      )
                  )
              ),0) AS usable_quantity
       FROM demand
       LEFT JOIN inventory_balance balance
         ON balance.location_id=? AND balance.inventory_pool_id=demand.inventory_pool_id`,
    )
    .bind(input.cartId, input.locationId, input.cartId, input.locationId)
    .all<DemandRow>();

  return rows.results.map((row) => ({
    inventoryPoolId: row.inventory_pool_id,
    requiredQuantity: row.required_quantity,
    usableQuantity: row.usable_quantity,
  }));
}

export function hasSufficientInstantInventory(demands: readonly InstantInventoryDemand[]): boolean {
  return demands.every((demand) => demand.usableQuantity >= demand.requiredQuantity);
}
