-- Products may belong to multiple catalog categories. product.category_id remains
-- the primary category for compatibility with existing catalog projections.
CREATE TABLE product_category (
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (product_id, category_id)
) STRICT;

CREATE UNIQUE INDEX product_category_primary_unique
ON product_category(product_id) WHERE is_primary = 1;

CREATE INDEX product_category_category_idx
ON product_category(category_id, product_id);

INSERT INTO product_category(product_id, category_id, is_primary, sort_order)
SELECT id, category_id, 1, 0 FROM product;
