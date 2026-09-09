-- Physical transit is separate from both location stock and Scheduled cycle goods.
INSERT INTO permission(id,code,description,created_at) VALUES
  ('permission-transfers-read','transfers.read','Read authorized warehouse transfers',0),
  ('permission-transfers-manage','transfers.manage','Manage authorized warehouse transfers',0);

CREATE TABLE inventory_transfer (
  id TEXT PRIMARY KEY NOT NULL,
  source_location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  destination_location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','RESOLVED','CANCELED')),
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  dispatched_at INTEGER CHECK(dispatched_at BETWEEN 0 AND 9007199254740991),
  CHECK(source_location_id <> destination_location_id)
) STRICT;
CREATE INDEX inventory_transfer_source_idx ON inventory_transfer(source_location_id,created_at DESC,id DESC);
CREATE INDEX inventory_transfer_destination_idx ON inventory_transfer(destination_location_id,created_at DESC,id DESC);
CREATE INDEX inventory_transfer_status_idx ON inventory_transfer(status,created_at DESC,id DESC);

CREATE TABLE inventory_transfer_line (
  id TEXT PRIMARY KEY NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES inventory_transfer(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  base_unit TEXT NOT NULL CHECK(base_unit IN ('GRAM','PIECE')),
  quantity_base INTEGER NOT NULL CHECK(quantity_base BETWEEN 1 AND 9007199254740991),
  accepted_base INTEGER NOT NULL DEFAULT 0 CHECK(accepted_base BETWEEN 0 AND quantity_base),
  damaged_base INTEGER NOT NULL DEFAULT 0 CHECK(damaged_base BETWEEN 0 AND quantity_base),
  shortage_base INTEGER NOT NULL DEFAULT 0 CHECK(shortage_base BETWEEN 0 AND quantity_base),
  lost_base INTEGER NOT NULL DEFAULT 0 CHECK(lost_base BETWEEN 0 AND quantity_base),
  returned_base INTEGER NOT NULL DEFAULT 0 CHECK(returned_base BETWEEN 0 AND quantity_base),
  CHECK(accepted_base+lost_base+returned_base <= quantity_base),
  CHECK(damaged_base+shortage_base <= quantity_base-accepted_base-lost_base-returned_base),
  UNIQUE(transfer_id,inventory_pool_id),
  UNIQUE(transfer_id,id)
) STRICT;

CREATE INDEX inventory_transfer_line_pool_idx ON inventory_transfer_line(inventory_pool_id,transfer_id);

CREATE TABLE inventory_transfer_receipt (
  id TEXT PRIMARY KEY NOT NULL,
  transfer_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  accepted_base INTEGER NOT NULL CHECK(accepted_base BETWEEN 1 AND 9007199254740991),
  received_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  received_at INTEGER NOT NULL CHECK(received_at BETWEEN 0 AND 9007199254740991),
  effect_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY(transfer_id,line_id) REFERENCES inventory_transfer_line(transfer_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX inventory_transfer_receipt_history_idx ON inventory_transfer_receipt(transfer_id,received_at DESC,id DESC);

CREATE TRIGGER inventory_transfer_identity_immutable BEFORE UPDATE OF id,source_location_id,destination_location_id,reason,created_by,created_at ON inventory_transfer
BEGIN SELECT RAISE(ABORT,'Transfer identity is immutable'); END;
CREATE TRIGGER inventory_transfer_delete_blocked BEFORE DELETE ON inventory_transfer
BEGIN SELECT RAISE(ABORT,'Transfer evidence is retained'); END;
CREATE TRIGGER inventory_transfer_line_identity_immutable BEFORE UPDATE OF id,transfer_id,inventory_pool_id,product_name,base_unit,quantity_base ON inventory_transfer_line
BEGIN SELECT RAISE(ABORT,'Transfer line identity is immutable'); END;
CREATE TRIGGER inventory_transfer_line_delete_blocked BEFORE DELETE ON inventory_transfer_line
BEGIN SELECT RAISE(ABORT,'Transfer line evidence is retained'); END;
CREATE TRIGGER inventory_transfer_receipt_immutable BEFORE UPDATE ON inventory_transfer_receipt
BEGIN SELECT RAISE(ABORT,'Transfer receipt is immutable'); END;
CREATE TRIGGER inventory_transfer_receipt_delete_blocked BEFORE DELETE ON inventory_transfer_receipt
BEGIN SELECT RAISE(ABORT,'Transfer receipt evidence is retained'); END;

CREATE TRIGGER inventory_transfer_dispatch_time_immutable BEFORE UPDATE OF dispatched_at ON inventory_transfer
WHEN OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at
BEGIN SELECT RAISE(ABORT,'Dispatch evidence is immutable'); END;

CREATE TABLE inventory_transfer_check (
  id TEXT PRIMARY KEY NOT NULL,
  transfer_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  accepted_base INTEGER NOT NULL CHECK(accepted_base BETWEEN 0 AND 9007199254740991),
  damaged_base INTEGER NOT NULL CHECK(damaged_base BETWEEN 0 AND 9007199254740991),
  shortage_base INTEGER NOT NULL CHECK(shortage_base BETWEEN 0 AND 9007199254740991),
  checked_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  checked_at INTEGER NOT NULL CHECK(checked_at BETWEEN 0 AND 9007199254740991),
  effect_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY(transfer_id,line_id) REFERENCES inventory_transfer_line(transfer_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX inventory_transfer_check_history_idx ON inventory_transfer_check(transfer_id,checked_at DESC,id DESC);
CREATE TRIGGER inventory_transfer_check_immutable BEFORE UPDATE ON inventory_transfer_check
BEGIN SELECT RAISE(ABORT,'Transfer checking evidence is immutable'); END;
CREATE TRIGGER inventory_transfer_check_delete_blocked BEFORE DELETE ON inventory_transfer_check
BEGIN SELECT RAISE(ABORT,'Transfer checking evidence is retained'); END;

CREATE TABLE inventory_transfer_resolution (
  id TEXT PRIMARY KEY NOT NULL,
  transfer_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  quantity_base INTEGER NOT NULL CHECK(quantity_base BETWEEN 1 AND 9007199254740991),
  category TEXT NOT NULL CHECK(category IN ('UNCLASSIFIED','DAMAGED','MISSING')),
  outcome TEXT NOT NULL CHECK(outcome IN ('LOSS','VERIFIED_RETURN')),
  inspection_confirmed INTEGER NOT NULL CHECK(inspection_confirmed IN (0,1)),
  resolved_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  resolved_at INTEGER NOT NULL CHECK(resolved_at BETWEEN 0 AND 9007199254740991),
  effect_key TEXT NOT NULL UNIQUE,
  FOREIGN KEY(transfer_id,line_id) REFERENCES inventory_transfer_line(transfer_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX inventory_transfer_resolution_history_idx ON inventory_transfer_resolution(transfer_id,resolved_at DESC,id DESC);
CREATE TRIGGER inventory_transfer_resolution_immutable BEFORE UPDATE ON inventory_transfer_resolution
BEGIN SELECT RAISE(ABORT,'Transfer resolution is immutable'); END;
CREATE TRIGGER inventory_transfer_resolution_delete_blocked BEFORE DELETE ON inventory_transfer_resolution
BEGIN SELECT RAISE(ABORT,'Transfer resolution is retained'); END;
