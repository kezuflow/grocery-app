-- Retained receipt quantities remain evidence of the former physical-stock path.
-- No retained inventory balance or ledger entry is rewritten or inferred as cycle goods.
ALTER TABLE receiving_record ADD COLUMN legacy_accepted_base INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_accepted_base BETWEEN 0 AND 9007199254740991 AND legacy_accepted_base <= accepted_quantity);
UPDATE receiving_record SET legacy_accepted_base=accepted_quantity;
CREATE TRIGGER receiving_legacy_accepted_immutable
BEFORE UPDATE OF legacy_accepted_base ON receiving_record
WHEN NEW.legacy_accepted_base<>OLD.legacy_accepted_base
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEGACY_RECEIPT_EVIDENCE'); END;

CREATE TABLE cycle_goods_balance (
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  received_base INTEGER NOT NULL DEFAULT 0 CHECK (received_base BETWEEN 0 AND 9007199254740991),
  packed_base INTEGER NOT NULL DEFAULT 0 CHECK (packed_base BETWEEN 0 AND 9007199254740991),
  surplus_released_base INTEGER NOT NULL DEFAULT 0 CHECK (surplus_released_base BETWEEN 0 AND 9007199254740991),
  disposed_base INTEGER NOT NULL DEFAULT 0 CHECK (disposed_base BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN -9007199254740991 AND 9007199254740991),
  PRIMARY KEY(cycle_id,location_id,inventory_pool_id),
  CHECK (packed_base+surplus_released_base+disposed_base<=received_base)
) STRICT;
CREATE TABLE cycle_goods_movement (
  id TEXT PRIMARY KEY NOT NULL,
  cycle_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  inventory_pool_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIPT','PACKING','SURPLUS_RELEASE','DISPOSAL')),
  quantity_base INTEGER NOT NULL CHECK (quantity_base BETWEEN 1 AND 9007199254740991),
  receiving_event_id TEXT REFERENCES receiving_event(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES grocery_order(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at INTEGER NOT NULL CHECK (occurred_at BETWEEN -9007199254740991 AND 9007199254740991),
  FOREIGN KEY(cycle_id,location_id,inventory_pool_id) REFERENCES cycle_goods_balance(cycle_id,location_id,inventory_pool_id) ON DELETE RESTRICT,
  CHECK ((movement_type='RECEIPT')=(receiving_event_id IS NOT NULL)),
  CHECK ((movement_type='PACKING')=(order_id IS NOT NULL)),
  UNIQUE(receiving_event_id),
  UNIQUE(order_id,inventory_pool_id)
) STRICT;
CREATE INDEX cycle_goods_movement_balance_idx ON cycle_goods_movement(cycle_id,location_id,inventory_pool_id,occurred_at,id);
-- Stable ownership/evidence relationships, not operational eligibility policy.
CREATE TRIGGER cycle_goods_receipt_evidence BEFORE INSERT ON cycle_goods_movement
WHEN NEW.receiving_event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM receiving_event event JOIN procurement_requirement requirement
    ON requirement.id=event.procurement_requirement_id
  WHERE event.id=NEW.receiving_event_id AND event.location_id=NEW.location_id
    AND event.inventory_pool_id=NEW.inventory_pool_id AND event.accepted_delta=NEW.quantity_base
    AND requirement.delivery_cycle_id=NEW.cycle_id
)
BEGIN SELECT RAISE(ABORT,'INVALID_CYCLE_RECEIPT_EVIDENCE'); END;
CREATE TRIGGER cycle_goods_order_ownership BEFORE INSERT ON cycle_goods_movement
WHEN NEW.order_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM grocery_order grocery JOIN fulfillment_record fulfillment ON fulfillment.order_id=grocery.id
  WHERE grocery.id=NEW.order_id AND grocery.cycle_id=NEW.cycle_id AND fulfillment.location_id=NEW.location_id
)
BEGIN SELECT RAISE(ABORT,'INVALID_CYCLE_ORDER_OWNERSHIP'); END;
CREATE TRIGGER cycle_goods_movement_no_update BEFORE UPDATE ON cycle_goods_movement
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CYCLE_GOODS_MOVEMENT'); END;
CREATE TRIGGER cycle_goods_movement_no_delete BEFORE DELETE ON cycle_goods_movement
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CYCLE_GOODS_MOVEMENT'); END;
