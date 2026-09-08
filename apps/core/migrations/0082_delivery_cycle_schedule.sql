-- Existing committed cycle/order evidence is retained. Missing scheduling facts
-- stay unavailable until an operator configures them; no historical windows are invented.
CREATE TABLE delivery_cycle_schedule (
  cycle_id TEXT NOT NULL PRIMARY KEY REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  timezone TEXT NOT NULL CHECK(length(timezone)>0),
  procurement_at INTEGER NOT NULL CHECK(procurement_at BETWEEN -9007199254740991 AND 9007199254740991),
  preparation_at INTEGER NOT NULL CHECK(preparation_at BETWEEN -9007199254740991 AND 9007199254740991),
  pickup_at INTEGER NOT NULL CHECK(pickup_at BETWEEN -9007199254740991 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN -9007199254740991 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;

CREATE TABLE delivery_cycle_window (
  id TEXT NOT NULL PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  starts_at INTEGER NOT NULL CHECK(starts_at BETWEEN -9007199254740991 AND 9007199254740991),
  ends_at INTEGER NOT NULL CHECK(ends_at BETWEEN -9007199254740991 AND 9007199254740991 AND ends_at>starts_at),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN -9007199254740991 AND 9007199254740991),
  UNIQUE(cycle_id,name)
) STRICT;
CREATE INDEX delivery_cycle_window_cycle_idx ON delivery_cycle_window(cycle_id,starts_at,id);
CREATE UNIQUE INDEX delivery_cycle_window_identity_idx ON delivery_cycle_window(id,cycle_id);
CREATE UNIQUE INDEX order_fulfillment_snapshot_cycle_idx ON order_fulfillment_snapshot(order_id,cycle_id);

CREATE TABLE order_delivery_window_snapshot (
  order_id TEXT NOT NULL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  timezone TEXT NOT NULL CHECK(length(timezone)>0),
  starts_at INTEGER NOT NULL CHECK(starts_at BETWEEN -9007199254740991 AND 9007199254740991),
  ends_at INTEGER NOT NULL CHECK(ends_at BETWEEN -9007199254740991 AND 9007199254740991 AND ends_at>starts_at),
  pickup_at INTEGER NOT NULL CHECK(pickup_at BETWEEN -9007199254740991 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN -9007199254740991 AND 9007199254740991),
  FOREIGN KEY(order_id,cycle_id) REFERENCES order_fulfillment_snapshot(order_id,cycle_id) ON DELETE RESTRICT,
  FOREIGN KEY(window_id,cycle_id) REFERENCES delivery_cycle_window(id,cycle_id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER order_delivery_window_snapshot_immutable_update BEFORE UPDATE ON order_delivery_window_snapshot
BEGIN SELECT RAISE(ABORT,'immutable order delivery window'); END;
CREATE TRIGGER order_delivery_window_snapshot_immutable_delete BEFORE DELETE ON order_delivery_window_snapshot
BEGIN SELECT RAISE(ABORT,'immutable order delivery window'); END;
