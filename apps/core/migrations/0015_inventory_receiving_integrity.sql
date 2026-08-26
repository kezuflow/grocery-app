-- 0015_inventory_receiving_integrity.sql
-- Replay-safe receiving evidence and integrity guards for atomic stock commands.
-- Replaces the unapplied Phase 4C subscription draft (hash-verified evidence:
-- 08BBFD508A04873DA2DF3FC87558850003AC1640EE2FB6195DBDF73AF20FED2C) and must
-- not contain any subscription, membership, or payment architecture.

CREATE TABLE IF NOT EXISTS receiving_event (
  id TEXT PRIMARY KEY,
  receiving_record_id TEXT NOT NULL REFERENCES receiving_record(id),
  procurement_requirement_id TEXT NOT NULL REFERENCES procurement_requirement(id),
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id),
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id),
  accepted_delta INTEGER NOT NULL CHECK (accepted_delta >= 0),
  rejected_delta INTEGER NOT NULL CHECK (rejected_delta >= 0),
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  CHECK (accepted_delta + rejected_delta > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS receiving_event_idempotency_key_idx
  ON receiving_event(idempotency_key);

CREATE INDEX IF NOT EXISTS receiving_event_record_time_idx
  ON receiving_event(receiving_record_id, occurred_at);

CREATE INDEX IF NOT EXISTS receiving_event_requirement_time_idx
  ON receiving_event(procurement_requirement_id, occurred_at);
