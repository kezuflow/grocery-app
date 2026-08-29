-- Canonical unit conversions and sourcing vocabulary for Admin catalog.
-- Existing historical values are translated without rewriting old migrations.

ALTER TABLE unit ADD COLUMN canonical_base_code TEXT NOT NULL DEFAULT 'PIECE'
  CHECK (canonical_base_code IN ('GRAM', 'MILLILITER', 'PIECE'));
ALTER TABLE unit ADD COLUMN conversion_numerator INTEGER NOT NULL DEFAULT 1
  CHECK (conversion_numerator > 0);
ALTER TABLE unit ADD COLUMN conversion_denominator INTEGER NOT NULL DEFAULT 1
  CHECK (conversion_denominator > 0);
ALTER TABLE unit ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));
ALTER TABLE unit ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE unit ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE unit
SET canonical_base_code = CASE dimension
      WHEN 'MASS' THEN 'GRAM'
      WHEN 'VOLUME' THEN 'MILLILITER'
      ELSE 'PIECE'
    END,
    conversion_numerator = CASE code
      WHEN 'KILOGRAM' THEN 1000
      WHEN 'LITER' THEN 1000
      ELSE 1
    END,
    conversion_denominator = 1;

-- D1 keeps ON DELETE RESTRICT active even when foreign-key checks are
-- deferred. Keep the historical constrained column as compatibility storage
-- and make this checked canonical column authoritative for all runtime reads.
ALTER TABLE inventory_pool ADD COLUMN canonical_sourcing_mode TEXT NOT NULL DEFAULT 'STOCKED'
  CHECK (canonical_sourcing_mode IN ('STOCKED', 'PLANNED', 'ON_DEMAND', 'MIXED'));
UPDATE inventory_pool
SET canonical_sourcing_mode = CASE sourcing_mode
  WHEN 'PLANNED_PROCUREMENT' THEN 'PLANNED'
  WHEN 'HYBRID' THEN 'MIXED'
  ELSE sourcing_mode
END;

PRAGMA defer_foreign_keys = ON;

CREATE TABLE sku_location_availability_new (
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  sourcing_mode TEXT NOT NULL
    CHECK (sourcing_mode IN ('STOCKED', 'PLANNED', 'ON_DEMAND', 'MIXED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (sku_id, location_id)
);
INSERT INTO sku_location_availability_new
  (sku_id, location_id, availability_status, sourcing_mode, version)
SELECT sku_id,
       location_id,
       availability_status,
       CASE sourcing_mode
         WHEN 'PLANNED_PROCUREMENT' THEN 'PLANNED'
         WHEN 'HYBRID' THEN 'MIXED'
         ELSE sourcing_mode
       END,
       version
FROM sku_location_availability;
DROP TABLE sku_location_availability;
ALTER TABLE sku_location_availability_new RENAME TO sku_location_availability;
CREATE INDEX sku_location_availability_location_idx
  ON sku_location_availability(location_id, availability_status, sku_id);

UPDATE location_product_availability
SET sourcing_mode = CASE sourcing_mode
  WHEN 'PLANNED_PROCUREMENT' THEN 'PLANNED'
  WHEN 'HYBRID' THEN 'MIXED'
  ELSE sourcing_mode
END;
