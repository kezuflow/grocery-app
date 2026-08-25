-- Persisted MVP commercial policy and pre-commit inventory holds.

CREATE TABLE IF NOT EXISTS market_commerce_policy (
  market_id TEXT PRIMARY KEY REFERENCES market(id) ON DELETE CASCADE,
  minimum_basket_minor INTEGER NOT NULL CHECK (minimum_basket_minor >= 0),
  currency TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_zone_fee (
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  fee_minor INTEGER NOT NULL CHECK (fee_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (zone_id, location_id)
);

CREATE TABLE IF NOT EXISTS checkout_inventory_holds (
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
CREATE INDEX IF NOT EXISTS checkout_inventory_holds_status_idx
  ON checkout_inventory_holds(checkout_attempt_id, status);

INSERT OR IGNORE INTO market_commerce_policy
  (market_id, minimum_basket_minor, currency, version, updated_at)
VALUES ('market-metro-cebu', 50000, 'PHP', 1, 0);

INSERT OR IGNORE INTO delivery_zone_fee
  (zone_id, location_id, fee_minor, currency, status, version, updated_at)
VALUES ('zone-cebu-city-core', 'location-cebu-central', 0, 'PHP', 'active', 1, 0);
