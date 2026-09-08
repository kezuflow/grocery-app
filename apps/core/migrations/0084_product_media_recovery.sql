-- Forward upgrade: retain existing associations and R2 keys. No storage calls or data reset.
ALTER TABLE product_media ADD COLUMN content_digest TEXT
  CHECK (content_digest IS NULL OR (length(content_digest)=64 AND content_digest NOT GLOB '*[^0-9a-f]*'));

CREATE TABLE product_media_upload (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  command_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json)='object'),
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('PENDING','UNKNOWN','STORED','ATTACHED','ABANDONED')),
  lease_token TEXT,
  lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(command_scope,idempotency_key),
  FOREIGN KEY(command_scope,idempotency_key) REFERENCES idempotency_records(scope,idempotency_key) ON DELETE RESTRICT,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
) STRICT;

CREATE TABLE product_media_cleanup (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 9007199254740991),
  available_at INTEGER NOT NULL CHECK (available_at BETWEEN 0 AND 9007199254740991),
  lease_token TEXT,
  lease_expires_at INTEGER CHECK (lease_expires_at IS NULL OR lease_expires_at BETWEEN 0 AND 9007199254740991),
  last_error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN 0 AND 9007199254740991),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
) STRICT;
CREATE INDEX product_media_upload_recovery_idx ON product_media_upload(status,updated_at,id);
CREATE INDEX product_media_cleanup_due_idx ON product_media_cleanup(status,available_at,id);

-- Inactive retained associations remain evidence. Their object deletion is idempotent,
-- and becomes explicit pending work rather than relying on a browser to retry forever.
INSERT INTO product_media_cleanup(id,product_id,object_key,status,available_at,created_at,updated_at)
SELECT id,product_id,object_key,'PENDING',0,
  CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
FROM product_media WHERE status='inactive';
