-- A submitted checkout is no longer the customer's editable shopping cart.
-- Preserve its lines for payment reconciliation and create an empty successor.
UPDATE cart
SET status='PAYMENT_PENDING',version=version+1,updated_at=unixepoch('subsec')*1000
WHERE status='ACTIVE' AND EXISTS (
  SELECT 1 FROM checkout_quote q
  JOIN payment_intent p ON p.subject_type='checkout_quote' AND p.subject_id=q.id
  WHERE q.cart_id=cart.id AND q.customer_id=cart.customer_id
    AND p.purpose='GROCERY_CHECKOUT'
    AND p.status IN ('REQUIRES_ACTION','PROCESSING','SUCCEEDED')
    AND NOT EXISTS (SELECT 1 FROM order_payment_reaction committed WHERE committed.payment_intent_id=p.id)
);

INSERT INTO cart(id,customer_id,location_id,status,version,created_at,updated_at)
SELECT 'cart-after-submitted-'||c.id,c.customer_id,c.location_id,'ACTIVE',1,
       unixepoch('subsec')*1000,unixepoch('subsec')*1000
FROM cart c
JOIN checkout_quote q ON q.cart_id=c.id AND q.customer_id=c.customer_id
JOIN payment_intent p ON p.subject_type='checkout_quote' AND p.subject_id=q.id
WHERE c.status='PAYMENT_PENDING' AND p.purpose='GROCERY_CHECKOUT'
  AND p.status IN ('REQUIRES_ACTION','PROCESSING','SUCCEEDED')
  AND NOT EXISTS (SELECT 1 FROM order_payment_reaction committed WHERE committed.payment_intent_id=p.id)
  AND NOT EXISTS (SELECT 1 FROM cart active WHERE active.customer_id=c.customer_id AND active.status='ACTIVE')
GROUP BY c.customer_id;

CREATE INDEX cart_payment_pending_customer_idx
  ON cart(customer_id,updated_at DESC) WHERE status='PAYMENT_PENDING';
