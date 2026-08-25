-- Move compatibility defaults and price scope into persisted configuration.

ALTER TABLE market ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK (is_default IN (0, 1));
UPDATE market SET is_default = 1 WHERE code = 'METRO_CEBU';
CREATE UNIQUE INDEX IF NOT EXISTS market_one_default_idx
  ON market(is_default) WHERE is_default = 1;

ALTER TABLE fulfillment_location ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK (is_default IN (0, 1));
UPDATE fulfillment_location SET is_default = 1 WHERE id = 'location-cebu-central';
CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_location_market_default_idx
  ON fulfillment_location(market_id) WHERE is_default = 1;

ALTER TABLE subscription_offer ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK (is_default IN (0, 1));
UPDATE subscription_offer SET is_default = 1 WHERE code = 'TRIAL';
CREATE UNIQUE INDEX IF NOT EXISTS subscription_offer_one_default_idx
  ON subscription_offer(is_default) WHERE is_default = 1;

ALTER TABLE price_version ADD COLUMN market_id TEXT REFERENCES market(id) ON DELETE RESTRICT;
ALTER TABLE price_version ADD COLUMN location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT;
ALTER TABLE price_version ADD COLUMN price_type TEXT NOT NULL DEFAULT 'STANDARD';
UPDATE price_version SET market_id = (SELECT id FROM market WHERE is_default = 1) WHERE market_id IS NULL;
CREATE INDEX IF NOT EXISTS price_version_scope_active_idx
  ON price_version(sku_id, market_id, location_id, price_type, valid_from, valid_to, version);
