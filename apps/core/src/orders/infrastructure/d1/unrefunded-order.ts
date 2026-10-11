export const unrefundedOrderSql = `o.status NOT IN ('CANCELED','REFUNDED')
  AND NOT EXISTS (SELECT 1 FROM payment_attempt payment WHERE payment.id=o.payment_id
    AND payment.status IN ('PARTIALLY_REFUNDED','REFUNDED'))
  AND NOT EXISTS (SELECT 1 FROM payment_intent payment WHERE payment.id IN (
    SELECT payment_intent_id FROM payment_attempt WHERE id=o.payment_id
    UNION ALL SELECT payment_intent_id FROM order_payment_reaction WHERE order_id=o.id
    UNION ALL SELECT payment_intent_id FROM paid_order_amendment WHERE order_id=o.id AND status='COMMITTED'
  ) AND (payment.status IN ('PARTIALLY_REFUNDED','REFUNDED') OR EXISTS (
    SELECT 1 FROM payment_refund refund WHERE refund.payment_intent_id=payment.id AND refund.status='SUCCEEDED'
  )))`;
