CREATE TABLE customer_support_note (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  author_staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE RESTRICT,
  author_display_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK (typeof(body)='text' AND length(trim(body)) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991),
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX customer_support_note_customer_created ON customer_support_note(customer_id,created_at DESC,id DESC);
CREATE TRIGGER customer_support_note_immutable_update BEFORE UPDATE ON customer_support_note
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CUSTOMER_SUPPORT_NOTE'); END;
CREATE TRIGGER customer_support_note_immutable_delete BEFORE DELETE ON customer_support_note
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CUSTOMER_SUPPORT_NOTE'); END;
