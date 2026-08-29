-- 0021_instant_mode.sql
-- Program 5: first-class INSTANT fulfillment. This historical migration is
-- intentionally safe for populated databases paused after 0020: every child
-- of a rebuilt parent is backed up, dropped before its parent, recreated with
-- the correct final foreign key, and restored without changing business data.

PRAGMA defer_foreign_keys=ON;

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

-- Checkout Quote has no foreign-key children at this boundary, but copying to
-- a staging table prevents DROP from being the data-movement mechanism.
CREATE TABLE checkout_quote_0021_backup AS SELECT * FROM checkout_quote;
DROP TABLE checkout_quote;
CREATE TABLE checkout_quote (
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
INSERT INTO checkout_quote (
  id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, fulfillment_mode,
  currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json,
  address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version,
  expires_at, idempotency_key, created_at, updated_at
)
SELECT
  id, attempt_id, customer_id, cart_id, address_id, delivery_cycle_id, 'SCHEDULED',
  currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, lines_json,
  address_snapshot_json, cycle_snapshot_json, fulfillment_snapshot_json, status, version,
  expires_at, idempotency_key, created_at, updated_at
FROM checkout_quote_0021_backup;
DROP TABLE checkout_quote_0021_backup;
CREATE INDEX checkout_quote_cart_idx ON checkout_quote(cart_id, status);
CREATE INDEX checkout_quote_expiry_idx ON checkout_quote(status, expires_at);

-- checkout_attempts owns two ON DELETE CASCADE child tables. Back them up and
-- remove them before replacing the parent so no historical row is cascaded.
CREATE TABLE checkout_attempts_0021_backup AS SELECT * FROM checkout_attempts;
CREATE TABLE checkout_quote_snapshots_0021_backup AS SELECT * FROM checkout_quote_snapshots;
CREATE TABLE checkout_inventory_holds_0021_backup AS SELECT * FROM checkout_inventory_holds;
DROP TABLE checkout_quote_snapshots;
DROP TABLE checkout_inventory_holds;
DROP TABLE checkout_attempts;

CREATE TABLE checkout_attempts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  cart_id TEXT NOT NULL REFERENCES cart(id) ON DELETE RESTRICT,
  address_id TEXT NOT NULL REFERENCES customer_address(id) ON DELETE RESTRICT,
  cycle_id TEXT REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  quote_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((fulfillment_mode = 'SCHEDULED') = (cycle_id IS NOT NULL))
);
INSERT INTO checkout_attempts (
  id, customer_id, cart_id, address_id, cycle_id, fulfillment_mode, zone_id, location_id,
  quote_version, status, idempotency_key, expires_at, version, created_at, updated_at
)
SELECT
  id, customer_id, cart_id, address_id, cycle_id, 'SCHEDULED', zone_id, location_id,
  quote_version, status, idempotency_key, expires_at, version, created_at, updated_at
FROM checkout_attempts_0021_backup;
DROP TABLE checkout_attempts_0021_backup;
CREATE INDEX checkout_attempts_customer_idx ON checkout_attempts(customer_id, created_at);

CREATE TABLE checkout_quote_snapshots (
  id TEXT PRIMARY KEY,
  checkout_attempt_id TEXT NOT NULL REFERENCES checkout_attempts(id) ON DELETE CASCADE,
  merchandise_minor INTEGER NOT NULL,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  item_snapshot_json TEXT NOT NULL,
  eligibility_snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO checkout_quote_snapshots SELECT * FROM checkout_quote_snapshots_0021_backup;
DROP TABLE checkout_quote_snapshots_0021_backup;
CREATE UNIQUE INDEX checkout_quote_snapshots_attempt_idx
  ON checkout_quote_snapshots(checkout_attempt_id);

CREATE TABLE checkout_inventory_holds (
  id TEXT PRIMARY KEY,
  checkout_attempt_id TEXT NOT NULL REFERENCES checkout_attempts(id) ON DELETE CASCADE,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (checkout_attempt_id, inventory_pool_id)
);
INSERT INTO checkout_inventory_holds SELECT * FROM checkout_inventory_holds_0021_backup;
DROP TABLE checkout_inventory_holds_0021_backup;
CREATE INDEX checkout_inventory_holds_status_idx
  ON checkout_inventory_holds(checkout_attempt_id, status);

-- Immutable fulfillment evidence is not declared as an FK child, but its
-- Scheduled rows still require the new nullable cycle/promise representation.
CREATE TABLE order_fulfillment_snapshot_0021_backup AS
  SELECT * FROM order_fulfillment_snapshot;
DROP TABLE order_fulfillment_snapshot;
CREATE TABLE order_fulfillment_snapshot (
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
INSERT INTO order_fulfillment_snapshot (
  order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, promised_at,
  fulfillment_mode, sourcing_modes_json, created_at
)
SELECT
  order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, NULL,
  fulfillment_mode, sourcing_modes_json, created_at
FROM order_fulfillment_snapshot_0021_backup;
DROP TABLE order_fulfillment_snapshot_0021_backup;

-- grocery_order has a broad historical child graph. Stage every row, remove
-- children first, rebuild the parent, then recreate children and their indexes
-- and triggers against the new canonical parent name.
CREATE TABLE grocery_order_0021_backup AS SELECT * FROM grocery_order;
CREATE TABLE order_item_0021_backup AS SELECT * FROM order_item;
CREATE TABLE inventory_reservation_0021_backup AS SELECT * FROM inventory_reservation;
CREATE TABLE committed_demand_0021_backup AS SELECT * FROM committed_demand;
CREATE TABLE fulfillment_record_0021_backup AS SELECT * FROM fulfillment_record;
CREATE TABLE delivery_job_0021_backup AS SELECT * FROM delivery_job;
CREATE TABLE delivery_stop_0021_backup AS SELECT * FROM delivery_stop;
CREATE TABLE refund_0021_backup AS SELECT * FROM refund;
CREATE TABLE order_amendment_0021_backup AS SELECT * FROM order_amendment;
CREATE TABLE paid_order_amendment_0021_backup AS SELECT * FROM paid_order_amendment;
CREATE TABLE paid_order_amendment_line_0021_backup AS SELECT * FROM paid_order_amendment_line;

DROP TABLE paid_order_amendment_line;
DROP TABLE paid_order_amendment;
DROP TABLE delivery_stop;
DROP TABLE delivery_job;
DROP TABLE fulfillment_record;
DROP TABLE order_item;
DROP TABLE inventory_reservation;
DROP TABLE committed_demand;
DROP TABLE refund;
DROP TABLE order_amendment;
DROP TABLE grocery_order;

CREATE TABLE grocery_order (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  cycle_id TEXT REFERENCES delivery_cycle(id),
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  address_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES payment_attempt(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK ((fulfillment_mode = 'SCHEDULED') = (cycle_id IS NOT NULL))
);
INSERT INTO grocery_order (
  id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status,
  total_minor, currency, payment_id, version, created_at
)
SELECT
  id, customer_id, cycle_id, 'SCHEDULED', address_snapshot_json, status,
  total_minor, currency, payment_id, version, created_at
FROM grocery_order_0021_backup;
DROP TABLE grocery_order_0021_backup;
CREATE INDEX grocery_order_customer_idx ON grocery_order(customer_id, created_at);
CREATE UNIQUE INDEX grocery_order_payment_unique ON grocery_order(payment_id);

CREATE TABLE order_item (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id) ON DELETE CASCADE,
  sku_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  unit_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  line_total_minor INTEGER NOT NULL,
  base_quantity INTEGER NOT NULL
);
INSERT INTO order_item SELECT * FROM order_item_0021_backup;
DROP TABLE order_item_0021_backup;

CREATE TABLE inventory_reservation (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  location_id TEXT NOT NULL,
  inventory_pool_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO inventory_reservation SELECT * FROM inventory_reservation_0021_backup;
DROP TABLE inventory_reservation_0021_backup;
CREATE INDEX inventory_reservation_order_idx ON inventory_reservation(order_id, status);
CREATE TRIGGER inventory_reservation_guard
BEFORE INSERT ON inventory_reservation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM inventory_balance
    WHERE location_id = NEW.location_id
      AND inventory_pool_id = NEW.inventory_pool_id
      AND on_hand - reserved >= NEW.quantity
  ) THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;
CREATE TRIGGER inventory_reservation_increment
AFTER INSERT ON inventory_reservation
BEGIN
  UPDATE inventory_balance SET reserved = reserved + NEW.quantity
  WHERE location_id = NEW.location_id AND inventory_pool_id = NEW.inventory_pool_id;
END;

CREATE TABLE committed_demand (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  delivery_cycle_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  inventory_pool_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO committed_demand SELECT * FROM committed_demand_0021_backup;
DROP TABLE committed_demand_0021_backup;
CREATE INDEX committed_demand_cycle_idx
  ON committed_demand(delivery_cycle_id, location_id, inventory_pool_id, status);

CREATE TABLE fulfillment_record (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES grocery_order(id),
  location_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO fulfillment_record SELECT * FROM fulfillment_record_0021_backup;
DROP TABLE fulfillment_record_0021_backup;

CREATE TABLE delivery_job (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES grocery_order(id),
  cycle_id TEXT,
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  rider_user_id TEXT,
  status TEXT NOT NULL,
  address_snapshot_json TEXT NOT NULL,
  delivered_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((fulfillment_mode = 'SCHEDULED') = (cycle_id IS NOT NULL))
);
INSERT INTO delivery_job (
  id, order_id, cycle_id, fulfillment_mode, rider_user_id, status,
  address_snapshot_json, delivered_at, version
)
SELECT
  id, order_id, cycle_id, 'SCHEDULED', rider_user_id, status,
  address_snapshot_json, delivered_at, version
FROM delivery_job_0021_backup;
DROP TABLE delivery_job_0021_backup;

CREATE TABLE delivery_stop (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES delivery_batch(id),
  delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id),
  sequence INTEGER,
  status TEXT NOT NULL,
  proof_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(batch_id, sequence)
);
INSERT INTO delivery_stop SELECT * FROM delivery_stop_0021_backup;
DROP TABLE delivery_stop_0021_backup;

CREATE TABLE refund (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_attempt(id),
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO refund SELECT * FROM refund_0021_backup;
DROP TABLE refund_0021_backup;

CREATE TABLE order_amendment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  payment_id TEXT REFERENCES payment_attempt(id),
  total_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO order_amendment SELECT * FROM order_amendment_0021_backup;
DROP TABLE order_amendment_0021_backup;

CREATE TABLE paid_order_amendment (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_PAYMENT','COMMITTED','FAILED','CANCELED')),
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  payment_intent_id TEXT REFERENCES payment_intent(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO paid_order_amendment SELECT * FROM paid_order_amendment_0021_backup;
DROP TABLE paid_order_amendment_0021_backup;
CREATE INDEX paid_order_amendment_order_idx ON paid_order_amendment(order_id, status);

CREATE TABLE paid_order_amendment_line (
  id TEXT PRIMARY KEY,
  amendment_id TEXT NOT NULL REFERENCES paid_order_amendment(id) ON DELETE CASCADE,
  sku_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  unit_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  base_quantity INTEGER NOT NULL CHECK (base_quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  created_at INTEGER NOT NULL
);
INSERT INTO paid_order_amendment_line SELECT * FROM paid_order_amendment_line_0021_backup;
DROP TABLE paid_order_amendment_line_0021_backup;
