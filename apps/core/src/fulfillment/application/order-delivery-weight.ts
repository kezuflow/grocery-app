import { FIXED_DELIVERY_PACKAGE_WEIGHT_GRAMS } from "../domain/delivery-package";

type OrderWeightInput = {
  orderId: string;
  candidateAmendmentId?: string;
  additionalWeightGrams?: number;
  includePaymentClaims: boolean;
};

export async function readOrderDeliveryWeight(
  database: D1Database,
  input: OrderWeightInput,
): Promise<{ grams: number; known: boolean }> {
  const row = await database
    .prepare("SELECT 1 AS found FROM order_item WHERE order_id=? LIMIT 1")
    .bind(input.orderId)
    .first<{ found: number }>();
  return {
    grams: row ? FIXED_DELIVERY_PACKAGE_WEIGHT_GRAMS : 0,
    known: Boolean(row),
  };
}

/** Joins the owning command's transaction and ensures the order still has a parcel. */
export function orderDeliveryWeightGuard(
  database: D1Database,
  input: OrderWeightInput,
): D1PreparedStatement {
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -43 WHERE NOT EXISTS (
      SELECT 1 FROM order_item WHERE order_id=? LIMIT 1
    )`)
    .bind(input.orderId);
}
