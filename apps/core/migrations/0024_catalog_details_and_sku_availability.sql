-- Additive catalog-detail and SKU-level availability storage for the
-- complete produce rollout. Extends SKU merchandising metadata, adds
-- ordered product/SKU detail rows, and introduces SKU-specific location
-- availability so Scheduled Cebu visibility no longer depends only on
-- product-level rows. Historical migrations stay untouched.

ALTER TABLE sku ADD COLUMN merchandising_label TEXT;
ALTER TABLE sku ADD COLUMN sell_quantity INTEGER NOT NULL DEFAULT 1 CHECK (sell_quantity > 0);
ALTER TABLE sku ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

-- Backfill sell quantity from exact base consumption for canonical gram and
-- piece sell units; packaging-unit SKUs sell one pack each.
UPDATE sku
SET sell_quantity = consumption_base_quantity
WHERE sellable_unit_id IN ('unit-gram', 'unit-piece');
UPDATE sku
SET sell_quantity = 1, merchandising_label = 'Pack'
WHERE sellable_unit_id = 'unit-pack';

CREATE TABLE product_detail (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, label)
);

CREATE TABLE sku_detail (
  id TEXT PRIMARY KEY NOT NULL,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('CUSTOMER', 'OPERATIONS')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(sku_id, audience, label)
);

CREATE TABLE sku_location_availability (
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  sourcing_mode TEXT NOT NULL CHECK (sourcing_mode IN ('STOCKED', 'PLANNED_PROCUREMENT', 'HYBRID')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (sku_id, location_id)
);
CREATE INDEX sku_location_availability_location_idx
  ON sku_location_availability(location_id, availability_status, sku_id);

-- Derive launch SKU availability from the most recent product-level row per
-- (location, product), preferring its explicit sourcing value and falling back
-- to the inventory pool's sourcing mode. Deterministic against committed seed
-- history; later changes flow through explicit application commands.
INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version)
SELECT s.id,
       lpa.location_id,
       lpa.availability_status,
       COALESCE(lpa.sourcing_mode, ip.sourcing_mode),
       1
FROM sku s
JOIN product p ON p.id = s.product_id AND s.status = 'active'
JOIN inventory_pool ip ON ip.id = p.inventory_pool_id
JOIN location_product_availability lpa ON lpa.product_id = p.id
WHERE lpa.valid_from = (
  SELECT MAX(latest.valid_from)
  FROM location_product_availability latest
  WHERE latest.location_id = lpa.location_id
    AND latest.product_id = lpa.product_id
);
