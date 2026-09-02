-- Canonical global fulfillment mode, exact-location SKU pricing, and local
-- Variant activation. Historical Order/Quote snapshots remain untouched.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE global_fulfillment_mode (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'global'),
  active_mode TEXT NOT NULL CHECK (active_mode IN ('INSTANT', 'SCHEDULED')),
  cadence TEXT CHECK (
    (active_mode = 'SCHEDULED' AND cadence = 'WEEKLY') OR
    (active_mode = 'INSTANT' AND cadence IS NULL)
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO global_fulfillment_mode
  (id, active_mode, cadence, version, created_at, updated_at)
SELECT
  'global',
  COALESCE(
    (SELECT mode.active_mode
       FROM fulfillment_location_mode mode
       JOIN fulfillment_location location ON location.id = mode.location_id
      ORDER BY location.is_default DESC, location.id ASC
      LIMIT 1),
    'SCHEDULED'
  ),
  CASE
    WHEN COALESCE(
      (SELECT mode.active_mode
         FROM fulfillment_location_mode mode
         JOIN fulfillment_location location ON location.id = mode.location_id
        ORDER BY location.is_default DESC, location.id ASC
        LIMIT 1),
      'SCHEDULED'
    ) = 'SCHEDULED' THEN 'WEEKLY'
    ELSE NULL
  END,
  1,
  COALESCE((SELECT MIN(created_at) FROM fulfillment_location_mode), 0),
  COALESCE((SELECT MAX(updated_at) FROM fulfillment_location_mode), 0);

CREATE TABLE fulfillment_location_readiness (
  location_id TEXT PRIMARY KEY NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  instant_promise_minutes INTEGER CHECK (instant_promise_minutes IS NULL OR instant_promise_minutes > 0),
  max_concurrent_instant_orders INTEGER CHECK (
    max_concurrent_instant_orders IS NULL OR max_concurrent_instant_orders > 0
  ),
  dispatch_ready INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_ready IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO fulfillment_location_readiness (
  location_id,
  instant_promise_minutes,
  max_concurrent_instant_orders,
  dispatch_ready,
  version,
  created_at,
  updated_at
)
SELECT
  location.id,
  mode.promise_minutes,
  mode.max_concurrent_instant_orders,
  CASE
    WHEN mode.promise_minutes IS NOT NULL
      AND mode.max_concurrent_instant_orders IS NOT NULL THEN 1
    ELSE 0
  END,
  COALESCE(mode.version, 1),
  COALESCE(mode.created_at, 0),
  COALESCE(mode.updated_at, 0)
FROM fulfillment_location location
LEFT JOIN fulfillment_location_mode mode ON mode.location_id = location.id;

DROP TABLE fulfillment_location_mode;

DROP TRIGGER IF EXISTS price_version_values_insert_guard;
DROP TRIGGER IF EXISTS price_version_overlap_insert_guard;
DROP TRIGGER IF EXISTS price_version_values_update_guard;
DROP TRIGGER IF EXISTS price_version_overlap_update_guard;
DROP INDEX IF EXISTS price_version_open_market_unique;
DROP INDEX IF EXISTS price_version_open_location_unique;
DROP INDEX IF EXISTS price_version_winner_idx;
DROP INDEX IF EXISTS price_version_scope_active_idx;
DROP INDEX IF EXISTS price_version_active_idx;

ALTER TABLE price_version RENAME TO price_version_0052_legacy;

CREATE TABLE price_version (
  id TEXT PRIMARY KEY NOT NULL,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  valid_from INTEGER NOT NULL CHECK (valid_from >= 0),
  valid_to INTEGER CHECK (valid_to IS NULL OR valid_to > valid_from),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at INTEGER NOT NULL,
  market_id TEXT NOT NULL REFERENCES market(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  price_type TEXT NOT NULL DEFAULT 'STANDARD',
  UNIQUE (sku_id, location_id, price_type, version)
);

-- Preserve every exact-location price. Exact rows are authoritative whenever
-- historical market and location rows both exist.
INSERT INTO price_version (
  id, sku_id, currency, amount_minor, valid_from, valid_to, version, created_at,
  market_id, location_id, price_type
)
SELECT
  id, sku_id, currency, amount_minor, valid_from, valid_to, version, created_at,
  market_id, location_id, price_type
FROM price_version_0052_legacy
WHERE location_id IS NOT NULL;

-- Backfill market-only history to every active location in that Market only
-- when that SKU/location/price-type has no exact history at all.
INSERT INTO price_version (
  id, sku_id, currency, amount_minor, valid_from, valid_to, version, created_at,
  market_id, location_id, price_type
)
SELECT
  legacy.id || '@' || location.id,
  legacy.sku_id,
  legacy.currency,
  legacy.amount_minor,
  legacy.valid_from,
  legacy.valid_to,
  legacy.version,
  legacy.created_at,
  legacy.market_id,
  location.id,
  legacy.price_type
FROM price_version_0052_legacy legacy
JOIN fulfillment_location location
  ON location.market_id = legacy.market_id
 AND location.status = 'active'
WHERE legacy.location_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM price_version_0052_legacy exact
    WHERE exact.sku_id = legacy.sku_id
      AND exact.location_id = location.id
      AND exact.price_type = legacy.price_type
  );

DROP TABLE price_version_0052_legacy;

CREATE UNIQUE INDEX price_version_open_location_unique
  ON price_version(sku_id, location_id, price_type)
  WHERE valid_to IS NULL;
CREATE INDEX price_version_winner_idx
  ON price_version(sku_id, location_id, price_type, valid_from DESC, version DESC);

CREATE TRIGGER price_version_values_insert_guard
BEFORE INSERT ON price_version
WHEN NEW.amount_minor <= 0
  OR NEW.version <= 0
  OR NEW.valid_from < 0
  OR (NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from)
  OR NEW.currency != (SELECT currency FROM market WHERE id = NEW.market_id)
  OR NEW.market_id != (SELECT market_id FROM fulfillment_location WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_LOCATION_PRICE_VALUES');
END;

CREATE TRIGGER price_version_overlap_insert_guard
BEFORE INSERT ON price_version
WHEN EXISTS (
  SELECT 1 FROM price_version existing
  WHERE existing.sku_id = NEW.sku_id
    AND existing.location_id = NEW.location_id
    AND existing.price_type = NEW.price_type
    AND NEW.valid_from < COALESCE(existing.valid_to, 9223372036854775807)
    AND existing.valid_from < COALESCE(NEW.valid_to, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'OVERLAPPING_LOCATION_PRICE_WINDOW');
END;

CREATE TRIGGER price_version_values_update_guard
BEFORE UPDATE OF currency, amount_minor, valid_from, valid_to, version, market_id, location_id
ON price_version
WHEN NEW.amount_minor <= 0
  OR NEW.version <= 0
  OR NEW.valid_from < 0
  OR (NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from)
  OR NEW.currency != (SELECT currency FROM market WHERE id = NEW.market_id)
  OR NEW.market_id != (SELECT market_id FROM fulfillment_location WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_LOCATION_PRICE_VALUES');
END;

CREATE TRIGGER price_version_overlap_update_guard
BEFORE UPDATE OF valid_from, valid_to, location_id, price_type ON price_version
WHEN EXISTS (
  SELECT 1 FROM price_version existing
  WHERE existing.id != NEW.id
    AND existing.sku_id = NEW.sku_id
    AND existing.location_id = NEW.location_id
    AND existing.price_type = NEW.price_type
    AND NEW.valid_from < COALESCE(existing.valid_to, 9223372036854775807)
    AND existing.valid_from < COALESCE(NEW.valid_to, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'OVERLAPPING_LOCATION_PRICE_WINDOW');
END;

ALTER TABLE sku_location_availability RENAME TO sku_location_availability_0052_legacy;

CREATE TABLE sku_location_availability (
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  -- Compatibility-only: runtime contracts, queries, and commands never read
  -- or write this legacy value. A later archival migration may remove it.
  sourcing_mode TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (sourcing_mode IN ('STOCKED', 'PLANNED', 'ON_DEMAND', 'MIXED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (sku_id, location_id)
);

INSERT INTO sku_location_availability
  (sku_id, location_id, availability_status, sourcing_mode, version)
SELECT sku_id, location_id, availability_status, sourcing_mode, version
FROM sku_location_availability_0052_legacy;

DROP TABLE sku_location_availability_0052_legacy;
CREATE INDEX sku_location_availability_location_idx
  ON sku_location_availability(location_id, availability_status, sku_id);

PRAGMA defer_foreign_keys = OFF;
