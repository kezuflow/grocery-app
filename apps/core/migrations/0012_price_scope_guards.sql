-- Enforce the canonical price scope for newly written price versions.

CREATE TRIGGER IF NOT EXISTS price_version_scope_insert_guard
BEFORE INSERT ON price_version
WHEN NEW.market_id IS NULL
  OR NEW.price_type NOT IN ('STANDARD', 'PROMOTIONAL', 'MEMBER')
  OR (NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fulfillment_location fl
    WHERE fl.id = NEW.location_id AND fl.market_id = NEW.market_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PRICE_SCOPE');
END;

CREATE TRIGGER IF NOT EXISTS price_version_scope_update_guard
BEFORE UPDATE OF market_id, location_id, price_type ON price_version
WHEN NEW.market_id IS NULL
  OR NEW.price_type NOT IN ('STANDARD', 'PROMOTIONAL', 'MEMBER')
  OR (NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM fulfillment_location fl
    WHERE fl.id = NEW.location_id AND fl.market_id = NEW.market_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PRICE_SCOPE');
END;
