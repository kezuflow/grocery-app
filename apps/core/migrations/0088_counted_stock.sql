-- Counted sizes own exact piece pools; bulk weight remains receipt/sorting evidence.
-- Existing weight and count products continue using their shared product pool.
ALTER TABLE product ADD COLUMN stock_tracking TEXT NOT NULL DEFAULT 'SHARED'
  CHECK(stock_tracking IN ('SHARED','COUNTED_SIZES'));
ALTER TABLE sku ADD COLUMN stock_pool_id TEXT REFERENCES inventory_pool(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX sku_stock_pool_unique ON sku(stock_pool_id) WHERE stock_pool_id IS NOT NULL;

CREATE TABLE inventory_sort (
  id TEXT PRIMARY KEY NOT NULL,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  source_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  quantity_grams INTEGER NOT NULL CHECK(quantity_grams BETWEEN 1 AND 9007199254740991),
  transfer_receipt_id TEXT REFERENCES inventory_transfer_receipt(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  effect_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE inventory_sort_output (
  sort_id TEXT NOT NULL REFERENCES inventory_sort(id) ON DELETE RESTRICT,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  sku_name TEXT NOT NULL,
  quantity_pieces INTEGER NOT NULL CHECK(quantity_pieces BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(sort_id,sku_id),
  UNIQUE(sort_id,inventory_pool_id)
) STRICT;
CREATE INDEX inventory_sort_history_idx ON inventory_sort(location_id,product_id,created_at DESC,id DESC);
CREATE TRIGGER inventory_sort_immutable BEFORE UPDATE ON inventory_sort
BEGIN SELECT RAISE(ABORT,'Stock sorting evidence is immutable'); END;
CREATE TRIGGER inventory_sort_delete_blocked BEFORE DELETE ON inventory_sort
BEGIN SELECT RAISE(ABORT,'Stock sorting evidence is retained'); END;
CREATE TRIGGER inventory_sort_output_immutable BEFORE UPDATE ON inventory_sort_output
BEGIN SELECT RAISE(ABORT,'Stock sorting evidence is immutable'); END;
CREATE TRIGGER inventory_sort_output_delete_blocked BEFORE DELETE ON inventory_sort_output
BEGIN SELECT RAISE(ABORT,'Stock sorting evidence is retained'); END;
