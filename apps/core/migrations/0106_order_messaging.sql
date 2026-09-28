-- Order-scoped Customer/Admin messages. D1 owns the transcript and intent;
-- R2 stores only private attachment bytes under generated messages/ keys.
CREATE TABLE order_conversation (
  order_id TEXT PRIMARY KEY REFERENCES grocery_order(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  customer_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (customer_read_sequence >= 0),
  admin_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (admin_read_sequence >= 0),
  acknowledgement_sent INTEGER NOT NULL DEFAULT 0 CHECK (acknowledgement_sent IN (0,1)),
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (last_message_at IS NULL OR last_message_at >= created_at)
) STRICT;
CREATE INDEX order_conversation_customer_activity
  ON order_conversation(customer_id,last_message_at DESC,order_id);
CREATE INDEX order_conversation_admin_activity
  ON order_conversation(last_message_at DESC,order_id);

CREATE TABLE order_message (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES order_conversation(order_id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('CUSTOMER','ADMIN','AUTOMATION')),
  sender_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
  payload_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,sequence),
  CHECK ((sender_kind='AUTOMATION') = (sender_user_id IS NULL))
) STRICT;
CREATE INDEX order_message_order_sequence ON order_message(order_id,sequence DESC);
CREATE TRIGGER order_message_no_update BEFORE UPDATE ON order_message
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_MESSAGE'); END;
CREATE TRIGGER order_message_no_delete BEFORE DELETE ON order_message
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_MESSAGE'); END;

-- Deleting this child removes readable text without rewriting immutable evidence.
CREATE TABLE order_message_content (
  message_id TEXT PRIMARY KEY REFERENCES order_message(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(body) <= 2000)
) STRICT;
CREATE TRIGGER order_message_content_no_update BEFORE UPDATE ON order_message_content
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_MESSAGE_CONTENT'); END;

CREATE TABLE order_message_upload (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES order_conversation(order_id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('CUSTOMER','ADMIN')),
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  message_id TEXT REFERENCES order_message(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE CHECK (object_key LIKE 'messages/%'),
  file_name TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  content_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','UNKNOWN','STORED','ATTACHED','DELETE_PENDING','DELETED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delete_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delete_attempts >= 0),
  next_attempt_at INTEGER,
  CHECK (message_id IS NULL OR status IN ('ATTACHED','DELETE_PENDING','DELETED'))
) STRICT;
CREATE INDEX order_message_upload_message ON order_message_upload(message_id,status);
CREATE INDEX order_message_upload_cleanup ON order_message_upload(status,next_attempt_at,created_at);

CREATE TABLE order_message_receipt (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES order_conversation(order_id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('CUSTOMER','ADMIN')),
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  payload_digest TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE REFERENCES order_message(id) DEFERRABLE INITIALLY DEFERRED,
  acknowledgement_message_id TEXT REFERENCES order_message(id) DEFERRABLE INITIALLY DEFERRED,
  sequence INTEGER NOT NULL,
  acknowledgement_sequence INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER order_message_receipt_no_update BEFORE UPDATE ON order_message_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_MESSAGE_RECEIPT'); END;
CREATE TRIGGER order_message_receipt_no_delete BEFORE DELETE ON order_message_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_MESSAGE_RECEIPT'); END;

CREATE TABLE order_message_hold (
  order_id TEXT PRIMARY KEY REFERENCES order_conversation(order_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  released_by_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE order_message_revision (
  audience_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  published_revision INTEGER NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
  CHECK (published_revision <= revision)
) STRICT;

CREATE TABLE order_message_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  acknowledgement_text TEXT NOT NULL CHECK (length(trim(acknowledgement_text)) BETWEEN 1 AND 500),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT
) STRICT;
INSERT INTO order_message_settings(id,acknowledgement_text,version,updated_at)
VALUES (1,'Thanks for messaging FreshMarkets. Our team has received your message and will reply here.',1,0);

CREATE TABLE order_message_settings_receipt (
  idempotency_key TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  payload_digest TEXT NOT NULL,
  result_text TEXT NOT NULL,
  result_version INTEGER NOT NULL CHECK (result_version > 0),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER order_message_settings_receipt_no_update
BEFORE UPDATE ON order_message_settings_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MESSAGE_SETTINGS_RECEIPT'); END;
CREATE TRIGGER order_message_settings_receipt_no_delete
BEFORE DELETE ON order_message_settings_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MESSAGE_SETTINGS_RECEIPT'); END;
