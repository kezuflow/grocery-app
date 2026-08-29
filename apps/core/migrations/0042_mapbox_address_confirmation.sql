ALTER TABLE customer_address ADD COLUMN address_components_json TEXT;
ALTER TABLE customer_address ADD COLUMN barangay TEXT;
ALTER TABLE customer_address ADD COLUMN city TEXT;
ALTER TABLE customer_address ADD COLUMN postal_code TEXT;
ALTER TABLE customer_address ADD COLUMN geocode_provider TEXT;
ALTER TABLE customer_address ADD COLUMN geocode_reference TEXT;
ALTER TABLE customer_address ADD COLUMN confirmation_source TEXT
  CHECK (confirmation_source IS NULL OR confirmation_source IN ('GEOCODER', 'USER_PIN', 'DEVICE_LOCATION'));
ALTER TABLE customer_address ADD COLUMN user_confirmed_at INTEGER;
ALTER TABLE customer_address ADD COLUMN delivery_instructions_json TEXT;

CREATE INDEX IF NOT EXISTS customer_address_owner_status_updated_idx
  ON customer_address(customer_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_address_resolved_zone_idx
  ON customer_address(delivery_zone_code, serviceable, status);
