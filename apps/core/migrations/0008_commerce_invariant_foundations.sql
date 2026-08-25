-- Remediation Pass 2: canonical commerce reservation, quote, event, and ledger records.
-- Historical migrations remain immutable. These structures are additive and
-- preserve the existing MVP RPCs as compatibility adapters.

CREATE TABLE IF NOT EXISTS cycle_zone_capacity (
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  allocated INTEGER NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cycle_id, zone_id, location_id)
);
CREATE INDEX IF NOT EXISTS cycle_zone_capacity_available_idx
  ON cycle_zone_capacity(cycle_id, zone_id, location_id, allocated, capacity);

CREATE TABLE IF NOT EXISTS capacity_allocations (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  checkout_attempt_id TEXT,
  order_id TEXT,
  units INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
  status TEXT NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (checkout_attempt_id),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS capacity_allocations_lookup_idx
  ON capacity_allocations(cycle_id, zone_id, location_id, status, expires_at);

CREATE TABLE IF NOT EXISTS checkout_attempts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  cart_id TEXT NOT NULL REFERENCES cart(id) ON DELETE RESTRICT,
  address_id TEXT NOT NULL REFERENCES customer_address(id) ON DELETE RESTRICT,
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  quote_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_attempts_customer_idx
  ON checkout_attempts(customer_id, created_at);

CREATE TABLE IF NOT EXISTS checkout_quote_snapshots (
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
CREATE UNIQUE INDEX IF NOT EXISTS checkout_quote_snapshots_attempt_idx
  ON checkout_quote_snapshots(checkout_attempt_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_reference TEXT,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_reference_idx
  ON payment_events(provider, provider_reference, received_at);

CREATE TABLE IF NOT EXISTS inventory_ledger_entries (
  id TEXT PRIMARY KEY,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL,
  quantity_delta_base INTEGER NOT NULL,
  reservation_delta_base INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  reason_code TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_idempotency_idx
  ON inventory_ledger_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_ledger_reference_idx
  ON inventory_ledger_entries(reference_type, reference_id, created_at);

ALTER TABLE payment_attempt ADD COLUMN checkout_attempt_id TEXT;
CREATE INDEX IF NOT EXISTS payment_attempt_checkout_idx ON payment_attempt(checkout_attempt_id);

INSERT OR IGNORE INTO cycle_zone_capacity
  (cycle_id, zone_id, location_id, capacity, allocated, version)
SELECT dc.id, dz.id, ls.location_id, dc.capacity, dc.allocated, 1
FROM delivery_cycle dc
JOIN market m ON m.id = dc.market_id
JOIN service_area sa ON sa.market_id = m.id AND sa.status = 'active'
JOIN delivery_zone dz ON dz.service_area_id = sa.id AND dz.status = 'active'
JOIN location_serviceability ls ON ls.zone_id = dz.id AND ls.eligible = 1
WHERE NOT EXISTS (
  SELECT 1 FROM cycle_zone_capacity c
  WHERE c.cycle_id = dc.id AND c.zone_id = dz.id AND c.location_id = ls.location_id
);

DROP TRIGGER IF EXISTS inventory_reservation_guard;
DROP TRIGGER IF EXISTS inventory_reservation_increment;
DROP TRIGGER IF EXISTS grocery_order_capacity_guard;
DROP TRIGGER IF EXISTS grocery_order_allocate_capacity;
