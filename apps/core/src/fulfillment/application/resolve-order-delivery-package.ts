import { fixedDeliveryPackage } from "../domain/delivery-package";

export type ResolvedOrderDeliveryPackage = Readonly<{
  kind: "BAG" | "BOX";
  quantity: 1;
  weightGrams: number;
}>;

export type ResolveOrderDeliveryPackageResult =
  | Readonly<{ ok: true; value: ResolvedOrderDeliveryPackage }>
  | Readonly<{
      ok: false;
      error: "ORDER_NOT_FOUND" | "ORDER_HAS_NO_ITEMS";
    }>;

/**
 * Resolve the fixed courier parcel for a non-empty committed order. Individual
 * line weights are optional metadata and do not control delivery eligibility.
 */
export async function resolveOrderDeliveryPackage(
  database: D1Database,
  orderId: string,
): Promise<ResolveOrderDeliveryPackageResult> {
  const order = await database
    .prepare("SELECT 1 AS found FROM grocery_order WHERE id=?")
    .bind(orderId)
    .first<{ found: number }>();
  if (!order) return { ok: false, error: "ORDER_NOT_FOUND" };

  const item = await database
    .prepare(
      `SELECT 1 AS found FROM order_item WHERE order_id=?
       UNION ALL
       SELECT 1 AS found FROM paid_order_amendment_line line
       JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
       WHERE amendment.order_id=? AND amendment.status='COMMITTED'
       LIMIT 1`,
    )
    .bind(orderId, orderId)
    .first<{ found: number }>();
  return item
    ? { ok: true, value: fixedDeliveryPackage() }
    : { ok: false, error: "ORDER_HAS_NO_ITEMS" };
}
