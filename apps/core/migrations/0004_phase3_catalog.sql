CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS unit (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS', 'COUNT', 'VOLUME')),
  symbol TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_pool (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL UNIQUE,
  base_unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
  sourcing_mode TEXT NOT NULL CHECK (sourcing_mode IN ('STOCKED', 'PLANNED_PROCUREMENT', 'HYBRID')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL UNIQUE REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  image_metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sku (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sellable_unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
  consumption_base_quantity INTEGER NOT NULL CHECK (consumption_base_quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS sku_product_status_idx ON sku(product_id, status, sort_order);

CREATE TABLE IF NOT EXISTS price_version (
  id TEXT PRIMARY KEY NOT NULL,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (sku_id, version)
);
CREATE INDEX IF NOT EXISTS price_version_active_idx ON price_version(sku_id, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS location_product_availability (
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  sourcing_mode TEXT,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  PRIMARY KEY (location_id, product_id, valid_from)
);
CREATE INDEX IF NOT EXISTS location_product_availability_active_idx ON location_product_availability(location_id, product_id, availability_status);

INSERT OR IGNORE INTO category (id, code, name, slug, status, sort_order, created_at, updated_at)
VALUES ('category-fresh-produce', 'FRESH_PRODUCE', 'Fresh produce', 'fresh-produce', 'active', 1, 0, 0);

INSERT OR IGNORE INTO unit (id, code, name, dimension, symbol, created_at) VALUES
  ('unit-gram', 'GRAM', 'Gram', 'MASS', 'g', 0),
  ('unit-kilogram', 'KILOGRAM', 'Kilogram', 'MASS', 'kg', 0),
  ('unit-piece', 'PIECE', 'Piece', 'COUNT', 'pc', 0),
  ('unit-pack', 'PACK', 'Pack', 'COUNT', 'pack', 0);

INSERT OR IGNORE INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, created_at, updated_at)
VALUES
  ('pool-red-onion', 'product-red-onion', 'unit-gram', 'HYBRID', 0, 0),
  ('pool-eggs', 'product-eggs', 'unit-piece', 'PLANNED_PROCUREMENT', 0, 0);

INSERT OR IGNORE INTO product (id, category_id, inventory_pool_id, slug, name, description, status, created_at, updated_at)
VALUES
  ('product-red-onion', 'category-fresh-produce', 'pool-red-onion', 'red-onion', 'Red onion', 'Fresh red onions.', 'active', 0, 0),
  ('product-eggs', 'category-fresh-produce', 'pool-eggs', 'farm-eggs', 'Farm eggs', 'Fresh farm eggs.', 'active', 0, 0);

INSERT OR IGNORE INTO sku (id, product_id, code, name, sellable_unit_id, consumption_base_quantity, status, sort_order, created_at, updated_at)
VALUES
  ('sku-red-onion-500g', 'product-red-onion', 'RED_ONION_500G', '500 g', 'unit-gram', 500, 'active', 1, 0, 0),
  ('sku-red-onion-1kg', 'product-red-onion', 'RED_ONION_1KG', '1 kg', 'unit-kilogram', 1000, 'active', 2, 0, 0),
  ('sku-eggs-6', 'product-eggs', 'FARM_EGGS_6', '6 pack', 'unit-pack', 6, 'active', 1, 0, 0),
  ('sku-eggs-12', 'product-eggs', 'FARM_EGGS_12', '12 pack', 'unit-pack', 12, 'active', 2, 0, 0);

INSERT OR IGNORE INTO price_version (id, sku_id, currency, amount_minor, valid_from, version, created_at)
VALUES
  ('price-red-onion-500g-v1', 'sku-red-onion-500g', 'PHP', 12900, 0, 1, 0),
  ('price-red-onion-1kg-v1', 'sku-red-onion-1kg', 'PHP', 23900, 0, 1, 0),
  ('price-eggs-6-v1', 'sku-eggs-6', 'PHP', 7800, 0, 1, 0),
  ('price-eggs-12-v1', 'sku-eggs-12', 'PHP', 14900, 0, 1, 0);

INSERT OR IGNORE INTO location_product_availability
  (location_id, product_id, availability_status, sourcing_mode, valid_from)
VALUES
  ('location-cebu-central', 'product-red-onion', 'AVAILABLE', 'HYBRID', 0),
  ('location-cebu-central', 'product-eggs', 'AVAILABLE', 'PLANNED_PROCUREMENT', 0);
