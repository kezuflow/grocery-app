-- Deterministic catalog mutation versions and non-overlapping price windows.

ALTER TABLE product ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE admin_command_abort (
  id INTEGER PRIMARY KEY CHECK (id = 0)
);

CREATE UNIQUE INDEX price_version_open_market_unique
  ON price_version(sku_id, market_id, price_type)
  WHERE location_id IS NULL AND valid_to IS NULL;
CREATE UNIQUE INDEX price_version_open_location_unique
  ON price_version(sku_id, market_id, location_id, price_type)
  WHERE location_id IS NOT NULL AND valid_to IS NULL;
CREATE INDEX price_version_winner_idx
  ON price_version(sku_id, market_id, location_id, price_type, valid_from DESC, version DESC);

CREATE TRIGGER price_version_values_insert_guard
BEFORE INSERT ON price_version
WHEN NEW.amount_minor <= 0
  OR NEW.version <= 0
  OR NEW.valid_from < 0
  OR (NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from)
  OR NEW.currency != (SELECT currency FROM market WHERE id = NEW.market_id)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PRICE_VALUES');
END;

CREATE TRIGGER price_version_overlap_insert_guard
BEFORE INSERT ON price_version
WHEN EXISTS (
  SELECT 1 FROM price_version existing
  WHERE existing.sku_id = NEW.sku_id
    AND existing.market_id = NEW.market_id
    AND existing.location_id IS NEW.location_id
    AND existing.price_type = NEW.price_type
    AND NEW.valid_from < COALESCE(existing.valid_to, 9223372036854775807)
    AND existing.valid_from < COALESCE(NEW.valid_to, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'OVERLAPPING_PRICE_WINDOW');
END;

CREATE TRIGGER price_version_values_update_guard
BEFORE UPDATE OF currency, amount_minor, valid_from, valid_to, version ON price_version
WHEN NEW.amount_minor <= 0
  OR NEW.version <= 0
  OR NEW.valid_from < 0
  OR (NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from)
  OR NEW.currency != (SELECT currency FROM market WHERE id = NEW.market_id)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PRICE_VALUES');
END;

CREATE TRIGGER price_version_overlap_update_guard
BEFORE UPDATE OF valid_from, valid_to, market_id, location_id, price_type ON price_version
WHEN EXISTS (
  SELECT 1 FROM price_version existing
  WHERE existing.id != NEW.id
    AND existing.sku_id = NEW.sku_id
    AND existing.market_id = NEW.market_id
    AND existing.location_id IS NEW.location_id
    AND existing.price_type = NEW.price_type
    AND NEW.valid_from < COALESCE(existing.valid_to, 9223372036854775807)
    AND existing.valid_from < COALESCE(NEW.valid_to, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'OVERLAPPING_PRICE_WINDOW');
END;
