-- Product-sale scope and remaining allowance. Existing benefits and paid
-- snapshots stay unchanged; Core owns activation, overlap and consumption.
CREATE TABLE promotion_product_target (
  promotion_id TEXT NOT NULL REFERENCES promotion(id),
  sku_id TEXT NOT NULL REFERENCES sku(id),
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id),
  quantity_limit INTEGER CHECK (quantity_limit IS NULL OR (typeof(quantity_limit)='integer' AND quantity_limit BETWEEN 1 AND 9007199254740991)),
  remaining_quantity INTEGER CHECK (remaining_quantity IS NULL OR (typeof(remaining_quantity)='integer' AND remaining_quantity BETWEEN 0 AND 9007199254740991)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (promotion_id, sku_id, location_id),
  CHECK ((quantity_limit IS NULL AND remaining_quantity IS NULL) OR (quantity_limit IS NOT NULL AND remaining_quantity IS NOT NULL AND remaining_quantity<=quantity_limit))
) STRICT;
CREATE INDEX promotion_product_target_option ON promotion_product_target(location_id,sku_id);
