-- Forward-only addition: campaign image publication is independent of financial definition versions.
CREATE TABLE promotion_media (
  id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL REFERENCES promotion(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  content_digest TEXT NOT NULL CHECK(length(content_digest)=64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
  alt_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN 0 AND 9007199254740991)
) STRICT;
CREATE UNIQUE INDEX promotion_media_primary_idx ON promotion_media(promotion_id) WHERE status='active';

CREATE TABLE promotion_media_upload (
  id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL REFERENCES promotion(id) ON DELETE RESTRICT,
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

CREATE TABLE promotion_media_cleanup (
  id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL REFERENCES promotion(id) ON DELETE RESTRICT,
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
CREATE INDEX promotion_media_upload_recovery_idx ON promotion_media_upload(status,updated_at,id);
CREATE INDEX promotion_media_cleanup_due_idx ON promotion_media_cleanup(status,available_at,id);
