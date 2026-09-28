-- Reserve before transformation and retain cancellation intent even if the
-- browser removes a photo before its upload RPC reaches Core.
ALTER TABLE order_message_upload ADD COLUMN normalization_ready INTEGER NOT NULL DEFAULT 1
  CHECK (normalization_ready IN (0,1));
ALTER TABLE order_message_upload ADD COLUMN normalization_claim TEXT;
ALTER TABLE order_message_upload ADD COLUMN normalization_claim_until INTEGER;

CREATE TABLE order_message_upload_cancel (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('CUSTOMER','ADMIN')),
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
) STRICT;
