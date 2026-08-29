-- 0043_financial_safety.sql
-- Explicit quote/order monetary components, resumable provider actions, and
-- one committed order per accepted checkout quote.

ALTER TABLE checkout_quote ADD COLUMN merchandise_subtotal_minor INTEGER NOT NULL DEFAULT 0
  CHECK (merchandise_subtotal_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN item_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (item_discount_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN order_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (order_discount_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN delivery_subtotal_minor INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_subtotal_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN delivery_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_discount_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN service_fee_minor INTEGER NOT NULL DEFAULT 0
  CHECK (service_fee_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0
  CHECK (tax_minor >= 0);

UPDATE checkout_quote
SET merchandise_subtotal_minor = subtotal_minor,
    item_discount_minor = 0,
    order_discount_minor = discount_minor,
    delivery_subtotal_minor = delivery_fee_minor,
    delivery_discount_minor = 0,
    service_fee_minor = 0,
    tax_minor = 0;

ALTER TABLE grocery_order ADD COLUMN merchandise_subtotal_minor INTEGER NOT NULL DEFAULT 0
  CHECK (merchandise_subtotal_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN item_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (item_discount_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN order_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (order_discount_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN delivery_subtotal_minor INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_subtotal_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN delivery_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_discount_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN service_fee_minor INTEGER NOT NULL DEFAULT 0
  CHECK (service_fee_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0
  CHECK (tax_minor >= 0);

ALTER TABLE order_payment_reaction ADD COLUMN checkout_quote_id TEXT;

UPDATE order_payment_reaction
SET checkout_quote_id = (
  SELECT payment_intent.subject_id
  FROM payment_intent
  WHERE payment_intent.id = order_payment_reaction.payment_intent_id
    AND payment_intent.subject_type = 'checkout_quote'
);

CREATE UNIQUE INDEX order_payment_reaction_quote_unique
  ON order_payment_reaction(checkout_quote_id)
  WHERE checkout_quote_id IS NOT NULL;

UPDATE grocery_order
SET merchandise_subtotal_minor = COALESCE(
      (
        SELECT checkout_quote.subtotal_minor
        FROM order_payment_reaction
        JOIN checkout_quote ON checkout_quote.id = order_payment_reaction.checkout_quote_id
        WHERE order_payment_reaction.order_id = grocery_order.id
      ),
      total_minor
    ),
    item_discount_minor = 0,
    order_discount_minor = COALESCE(
      (
        SELECT checkout_quote.discount_minor
        FROM order_payment_reaction
        JOIN checkout_quote ON checkout_quote.id = order_payment_reaction.checkout_quote_id
        WHERE order_payment_reaction.order_id = grocery_order.id
      ),
      0
    ),
    delivery_subtotal_minor = COALESCE(
      (
        SELECT checkout_quote.delivery_fee_minor
        FROM order_payment_reaction
        JOIN checkout_quote ON checkout_quote.id = order_payment_reaction.checkout_quote_id
        WHERE order_payment_reaction.order_id = grocery_order.id
      ),
      0
    ),
    delivery_discount_minor = 0,
    service_fee_minor = 0,
    tax_minor = 0;

CREATE TABLE payment_provider_action (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT REFERENCES payment_intent(id) ON DELETE RESTRICT,
  authorization_id TEXT REFERENCES payment_authorization(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('REDIRECT','SDK')),
  redirect_url TEXT,
  client_token TEXT,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (payment_intent_id IS NOT NULL AND authorization_id IS NULL)
    OR (payment_intent_id IS NULL AND authorization_id IS NOT NULL)
  ),
  CHECK (
    (action_type = 'REDIRECT' AND redirect_url IS NOT NULL AND client_token IS NULL)
    OR (action_type = 'SDK' AND client_token IS NOT NULL AND redirect_url IS NULL)
  )
);

CREATE UNIQUE INDEX payment_provider_action_active_intent_unique
  ON payment_provider_action(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL AND status = 'ACTIVE';
CREATE UNIQUE INDEX payment_provider_action_active_authorization_unique
  ON payment_provider_action(authorization_id)
  WHERE authorization_id IS NOT NULL AND status = 'ACTIVE';
CREATE INDEX payment_provider_action_expiry_idx
  ON payment_provider_action(status, expires_at);
CREATE INDEX payment_provider_action_provider_reference_idx
  ON payment_provider_action(provider, provider_reference);
