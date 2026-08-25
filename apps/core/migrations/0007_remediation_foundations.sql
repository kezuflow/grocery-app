-- Remediation Pass 1: append-only concurrency and idempotency foundations.
-- Existing migrations remain immutable historical records.
ALTER TABLE customer ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscription_offer ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscription ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_attempt ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE grocery_order ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory_balance ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inventory_reservation ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE committed_demand ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE procurement_requirement ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receiving_record ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fulfillment_record ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_job ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE refund ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_amendment ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_order ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supply_exception ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_batch ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_stop ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_type TEXT NOT NULL,
  result_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_records_status_idx
  ON idempotency_records(scope, status, updated_at);
