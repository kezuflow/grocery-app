-- Corrective migration after 0021. Restore indexes lost by table rebuilds and
-- add provider-neutral, versioned route-distance delivery pricing snapshots.

DROP INDEX IF EXISTS checkout_quote_new_cart_idx;
DROP INDEX IF EXISTS checkout_quote_new_expiry_idx;
CREATE INDEX IF NOT EXISTS checkout_quote_cart_idx ON checkout_quote(cart_id, status);
CREATE INDEX IF NOT EXISTS checkout_quote_expiry_idx ON checkout_quote(status, expires_at);
CREATE INDEX IF NOT EXISTS grocery_order_customer_idx ON grocery_order(customer_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_order_payment_unique ON grocery_order(payment_id);

CREATE TABLE IF NOT EXISTS delivery_fee_configuration (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES market(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL,
  minimum_delivery_fee_minor INTEGER NOT NULL CHECK (minimum_delivery_fee_minor >= 0),
  per_kilometer_rate_minor INTEGER NOT NULL CHECK (per_kilometer_rate_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  version INTEGER NOT NULL CHECK (version >= 1),
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (location_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_fee_configuration_active_unique
  ON delivery_fee_configuration(market_id, location_id)
  WHERE status='ACTIVE' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS delivery_fee_configuration_effective_idx
  ON delivery_fee_configuration(market_id, location_id, status, effective_from, effective_to);

ALTER TABLE checkout_quote ADD COLUMN delivery_fee_snapshot_json TEXT;
ALTER TABLE order_fulfillment_snapshot ADD COLUMN delivery_fee_snapshot_json TEXT;
