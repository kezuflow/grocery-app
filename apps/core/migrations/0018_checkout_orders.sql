-- 0018_checkout_orders.sql
-- Authoritative checkout quotes, paid-order snapshots, one-order-per-payment
-- intent, additive amendments, and durable finance exceptions.

CREATE TABLE IF NOT EXISTS checkout_quote (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  cart_id TEXT NOT NULL,
  address_id TEXT NOT NULL REFERENCES customer_address(id),
  delivery_cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id),
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
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS checkout_quote_cart_idx ON checkout_quote(cart_id, status);
CREATE INDEX IF NOT EXISTS checkout_quote_expiry_idx ON checkout_quote(status, expires_at);

-- One order per successful checkout payment intent.
CREATE TABLE IF NOT EXISTS order_payment_reaction (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intent(id),
  reaction_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

-- Immutable fulfillment snapshot for a committed order.
CREATE TABLE IF NOT EXISTS order_fulfillment_snapshot (
  order_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  cutoff_at INTEGER NOT NULL,
  delivery_date INTEGER NOT NULL,
  fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('INSTANT','SCHEDULED')),
  sourcing_modes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The legacy order_amendment table (0006) keeps historical rows untouched.
-- Canonical post-payment additions live in a dedicated additive structure.
CREATE TABLE IF NOT EXISTS paid_order_amendment (
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

CREATE INDEX IF NOT EXISTS paid_order_amendment_order_idx ON paid_order_amendment(order_id, status);

CREATE TABLE IF NOT EXISTS paid_order_amendment_line (
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

CREATE TABLE IF NOT EXISTS finance_exception (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('QUOTE_EXPIRED','MEMBERSHIP_LOST','CYCLE_CLOSED','CAPACITY_UNAVAILABLE','STOCK_UNAVAILABLE','TRANSIENT_FAILURE')),
  payment_intent_id TEXT REFERENCES payment_intent(id),
  reaction_id TEXT,
  order_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS finance_exception_open_idx ON finance_exception(status, created_at);
CREATE INDEX IF NOT EXISTS finance_exception_intent_idx ON finance_exception(payment_intent_id, status);

-- Transactional abort sentinel: exactly one row with id=0 may exist. A batched
-- INSERT of any other value violates the CHECK and rolls back the whole
-- commitment when guarded effects (reservations/capacity) did not fully land.
CREATE TABLE IF NOT EXISTS commitment_abort (
  id INTEGER PRIMARY KEY CHECK (id = 0)
);
INSERT OR IGNORE INTO commitment_abort (id) VALUES (0);
