import { MAX_ORDER_WEIGHT_GRAMS } from "../domain/delivery-package";

type OrderWeightInput = {
  orderId: string;
  candidateAmendmentId?: string;
  additionalWeightGrams?: number;
  includePaymentClaims: boolean;
};

// An admitted payment already owns durable intent. Its weight remains claimed
// until a definite failure/expiry/refund; unknown outcomes cannot free it.
const WEIGHT_FACTS = `WITH weights AS (
  SELECT shipping_weight_grams AS grams FROM order_item WHERE order_id=?
  UNION ALL
  SELECT line.shipping_weight_grams FROM paid_order_amendment_line line
  JOIN paid_order_amendment amendment ON amendment.id=line.amendment_id
  WHERE amendment.order_id=? AND (amendment.status='COMMITTED' OR amendment.id=? OR
    (?=1 AND amendment.status='PENDING_PAYMENT' AND EXISTS (
      SELECT 1 FROM payment_intent payment WHERE payment.id=amendment.payment_intent_id
        AND payment.status NOT IN ('FAILED','EXPIRED','REFUNDED')
    )))
), facts AS (
  SELECT total(grams)+? AS grams,
    EXISTS (SELECT 1 FROM order_item WHERE order_id=?)
      AND COUNT(*)=COUNT(grams) AND MIN(grams)>0 AS known
  FROM weights
)`;

function binds(input: OrderWeightInput): unknown[] {
  return [
    input.orderId,
    input.orderId,
    input.candidateAmendmentId ?? null,
    input.includePaymentClaims ? 1 : 0,
    input.additionalWeightGrams ?? 0,
    input.orderId,
  ];
}

export async function readOrderDeliveryWeight(
  database: D1Database,
  input: OrderWeightInput,
): Promise<{ grams: number; known: boolean }> {
  const row = await database
    .prepare(`${WEIGHT_FACTS} SELECT grams,known FROM facts`)
    .bind(...binds(input))
    .first<{ grams: number; known: number }>();
  return { grams: row?.grams ?? 0, known: row?.known === 1 };
}

/** Joins the owning command's transaction; a lost weight claim aborts all effects. */
export function orderDeliveryWeightGuard(
  database: D1Database,
  input: OrderWeightInput,
): D1PreparedStatement {
  return database
    .prepare(`${WEIGHT_FACTS} INSERT INTO commitment_abort(id)
    SELECT -43 FROM facts WHERE known IS NOT 1 OR grams<=0 OR grams>?`)
    .bind(...binds(input), MAX_ORDER_WEIGHT_GRAMS);
}
