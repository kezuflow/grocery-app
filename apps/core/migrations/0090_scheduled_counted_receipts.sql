CREATE TABLE scheduled_counted_receipt (
  id TEXT NOT NULL PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  cycle_name TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  received_weight_grams INTEGER NOT NULL CHECK(received_weight_grams BETWEEN 0 AND 9007199254740991),
  receipt_kind TEXT NOT NULL CHECK(receipt_kind IN ('DELIVERY','REPLACEMENT')),
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at INTEGER NOT NULL CHECK(received_at BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;
CREATE INDEX scheduled_counted_receipt_location_idx ON scheduled_counted_receipt(location_id,cycle_id,received_at,id);
CREATE UNIQUE INDEX receiving_event_record_identity_idx ON receiving_event(id,receiving_record_id);
CREATE TABLE scheduled_counted_receipt_line (
  receipt_id TEXT NOT NULL REFERENCES scheduled_counted_receipt(id) ON DELETE RESTRICT,
  receiving_record_id TEXT NOT NULL REFERENCES receiving_record(id) ON DELETE RESTRICT,
  sku_id TEXT NOT NULL REFERENCES sku(id) ON DELETE RESTRICT,
  variant_name TEXT NOT NULL,
  receiving_event_id TEXT,
  shortage_base INTEGER NOT NULL CHECK(shortage_base BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(receipt_id,receiving_record_id),
  UNIQUE(receipt_id,sku_id),
  FOREIGN KEY(receiving_event_id,receiving_record_id) REFERENCES receiving_event(id,receiving_record_id) ON DELETE RESTRICT,
  CHECK(receiving_event_id IS NOT NULL OR shortage_base>0)
) STRICT;
CREATE TRIGGER scheduled_counted_receipt_no_update BEFORE UPDATE ON scheduled_counted_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COUNTED_RECEIPT'); END;
CREATE TRIGGER scheduled_counted_receipt_no_delete BEFORE DELETE ON scheduled_counted_receipt
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COUNTED_RECEIPT'); END;
CREATE TRIGGER scheduled_counted_receipt_line_no_update BEFORE UPDATE ON scheduled_counted_receipt_line
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COUNTED_RECEIPT'); END;
CREATE TRIGGER scheduled_counted_receipt_line_no_delete BEFORE DELETE ON scheduled_counted_receipt_line
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COUNTED_RECEIPT'); END;
