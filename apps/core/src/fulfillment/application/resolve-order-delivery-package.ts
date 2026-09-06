import { deliveryPackageForLineWeights } from "../domain/delivery-package";

export type ResolvedOrderDeliveryPackage = Readonly<{
  kind: "BAG" | "BOX";
  quantity: 1;
  weightGrams: number;
}>;

export type ResolveOrderDeliveryPackageResult =
  | Readonly<{ ok: true; value: ResolvedOrderDeliveryPackage }>
  | Readonly<{
      ok: false;
      error: "ORDER_NOT_FOUND" | "ORDER_HAS_NO_ITEMS" | "SHIPPING_WEIGHT_UNAVAILABLE";
    }>;

/**
 * Resolve the package from immutable committed line snapshots. Only committed
 * paid additions participate; draft or unpaid amendments do not alter the
 * parcel handed to a courier.
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

  const rows = await database
    .prepare(
      `SELECT shipping_weight_grams AS shippingWeightGrams
       FROM order_item WHERE order_id=?
       UNION ALL
       SELECT line.shipping_weight_grams AS shippingWeightGrams
       FROM paid_order_amendment_line line
       JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
       WHERE amendment.order_id=? AND amendment.status='COMMITTED'`,
    )
    .bind(orderId, orderId)
    .all<{ shippingWeightGrams: number | null }>();
  if (rows.results.length === 0) return { ok: false, error: "ORDER_HAS_NO_ITEMS" };

  const deliveryPackage = deliveryPackageForLineWeights(
    rows.results.map((line) => line.shippingWeightGrams),
  );
  return deliveryPackage
    ? { ok: true, value: deliveryPackage }
    : { ok: false, error: "SHIPPING_WEIGHT_UNAVAILABLE" };
}
