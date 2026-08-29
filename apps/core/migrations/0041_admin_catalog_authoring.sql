ALTER TABLE category ADD COLUMN parent_id TEXT NULL REFERENCES category(id) ON DELETE RESTRICT;
ALTER TABLE category ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE INDEX category_parent_sort_status_idx
  ON category(parent_id, sort_order, status, id);
CREATE INDEX category_status_sort_idx
  ON category(status, sort_order, id);

CREATE TABLE product_media (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  alt_text TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX product_media_product_status_sort_idx
  ON product_media(product_id, status, sort_order, id);
CREATE UNIQUE INDEX product_media_one_primary_active_idx
  ON product_media(product_id) WHERE is_primary = 1 AND status = 'active';
