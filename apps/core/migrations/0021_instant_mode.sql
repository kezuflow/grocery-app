-- 0021_instant_mode.sql
-- Program 5: first-class INSTANT fulfillment. A location's single active mode
-- governs checkout semantics; instant orders never reference a delivery cycle.

CREATE TABLE IF NOT EXISTS fulfillment_location_mode (
  location_id TEXT PRIMARY KEY REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  active_mode TEXT NOT NULL CHECK (active_mode IN ('INSTANT', 'SCHEDULED')),
  promise_minutes INTEGER CHECK (promise_minutes IS NULL OR promise_minutes > 0),
  max_concurrent_instant_orders INTEGER
    CHECK (max_concurrent_instant_orders IS NULL OR max_concurrent_instant_orders > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE delivery_zone_fee ADD COLUMN instant_fee_minor INTEGER
  CHECK (instant_fee_minor IS NULL OR instant_fee_minor >= 0);

-- Pre-launch tables: rebuild forward so an INSTANT order/quote can exist
-- without a synthetic cycle (canonically forbidden).
CREATE TABLE IF NOT EXISTS checkout_quote_new (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  cart_id TEXT NOT NULL,
  address_id TEXT NOT NULL REFERENCES customer_address(id),
  delivery_cycle_id TEXT REFERENCES delivery_cycle(id),
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  lines_json TEXT NOT NULL,
  address_snapshot_json TEXT,
  cycle_snapshot_json TEXT,
  fulfillment_snapshot_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','SUPERSEDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((fulfillment_mode = 'SCHEDULED') = (delivery_cycle_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS checkout_quote_new_cart_idx ON checkout_quote_new(cart_id, status);
CREATE INDEX IF NOT EXISTS checkout_quote_new_expiry_idx ON checkout_quote_new(status, expires_at);

INSERT INTO checkout_quote_new
  (id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode,
   currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json,
   address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version,
   expires_at, idempotency_key, created_at, updated_at)
SELECT id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, 'SCHEDULED',
       currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json,
       address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version,
       expires_at, idempotency_key, created_at, updated_at
FROM checkout_quote;

DROP TABLE checkout_quote;
ALTER TABLE checkout_quote_new RENAME TO checkout_quote;

CREATE TABLE IF NOT EXISTS order_fulfillment_snapshot_new (
  order_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  cycle_id TEXT REFERENCES delivery_cycle(id),
  zone_id TEXT NOT NULL,
  cutoff_at INTEGER,
  delivery_date INTEGER,
  promised_at INTEGER,
  fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  sourcing_modes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((fulfillment_mode = 'SCHEDULED') = (cycle_id IS NOT NULL)),
  CHECK ((fulfillment_mode = 'SCHEDULED') = (cutoff_at IS NOT NULL AND delivery_date IS NOT NULL))
);

INSERT INTO order_fulfillment_snapshot_new
  (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at,
   fulfillment_mode, sourcing_modes_json, created_at)
SELECT order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, NULL,
       fulfillment_mode, sourcing_modes_json, created_at
FROM order_fulfillment_snapshot;

DROP TABLE order_fulfillment_snapshot;
ALTER TABLE order_fulfillment_snapshot_new RENAME TO order_fulfillment_snapshot;
