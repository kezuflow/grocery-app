-- Add Lalamove to the closed external-delivery provider vocabulary without
-- weakening the existing dispatch and authenticated-event constraints.

ALTER TABLE delivery_provider_event_inbox
  RENAME TO delivery_provider_event_inbox_0056_legacy;
ALTER TABLE delivery_provider_dispatch
  RENAME TO delivery_provider_dispatch_0056_legacy;

DROP INDEX delivery_provider_dispatch_status_updated_idx;
DROP INDEX delivery_provider_dispatch_provider_status_idx;
DROP INDEX delivery_provider_event_inbox_processing_idx;
DROP INDEX delivery_provider_event_inbox_delivery_idx;

CREATE TABLE delivery_provider_dispatch (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_job_id TEXT NOT NULL UNIQUE REFERENCES delivery_job(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('grab-express', 'lalamove')),
  merchant_order_id TEXT NOT NULL UNIQUE,
  provider_delivery_id TEXT UNIQUE,
  request_hash TEXT NOT NULL,
  request_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'PENDING',
      'CREATING',
      'RETRY_REQUIRED',
      'ACTIVE',
      'COMPLETED',
      'CANCELED',
      'RETURNED',
      'FAILED',
      'OUTCOME_UNKNOWN',
      'RECONCILIATION_REQUIRED'
    )
  ),
  provider_status TEXT,
  provider_observed_at INTEGER,
  provider_status_rank INTEGER CHECK (provider_status_rank IS NULL OR provider_status_rank >= 0),
  tracking_url TEXT,
  pickup_pin TEXT,
  quote_amount_minor INTEGER CHECK (quote_amount_minor IS NULL OR quote_amount_minor >= 0),
  quote_currency TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  checkout_quotation_id TEXT REFERENCES delivery_provider_quotation(id),
  final_quotation_id TEXT REFERENCES delivery_provider_quotation(id),
  pickup_timing TEXT CHECK (pickup_timing IS NULL OR pickup_timing IN ('IMMEDIATE', 'SCHEDULED')),
  scheduled_pickup_at INTEGER,
  final_payable_minor INTEGER CHECK (final_payable_minor IS NULL OR final_payable_minor >= 0),
  customer_delivery_charge_minor INTEGER
    CHECK (customer_delivery_charge_minor IS NULL OR customer_delivery_charge_minor >= 0),
  courier_variance_minor INTEGER,
  delivery_currency TEXT CHECK (delivery_currency IS NULL OR length(delivery_currency) = 3),
  CHECK (
    (quote_amount_minor IS NULL AND quote_currency IS NULL)
    OR (quote_amount_minor IS NOT NULL AND quote_currency IS NOT NULL)
  ),
  CHECK (
    (provider_observed_at IS NULL AND provider_status_rank IS NULL)
    OR (provider_observed_at IS NOT NULL AND provider_status_rank IS NOT NULL)
  )
);

INSERT INTO delivery_provider_dispatch (
  id, delivery_job_id, provider, merchant_order_id, provider_delivery_id,
  request_hash, request_snapshot_json, status, provider_status,
  provider_observed_at, provider_status_rank, tracking_url, pickup_pin,
  quote_amount_minor, quote_currency, attempt_count, last_error_code,
  version, created_at, updated_at, checkout_quotation_id, final_quotation_id,
  pickup_timing, scheduled_pickup_at, final_payable_minor,
  customer_delivery_charge_minor, courier_variance_minor, delivery_currency
)
SELECT
  id, delivery_job_id, provider, merchant_order_id, provider_delivery_id,
  request_hash, request_snapshot_json, status, provider_status,
  provider_observed_at, provider_status_rank, tracking_url, pickup_pin,
  quote_amount_minor, quote_currency, attempt_count, last_error_code,
  version, created_at, updated_at, checkout_quotation_id, final_quotation_id,
  pickup_timing, scheduled_pickup_at, final_payable_minor,
  customer_delivery_charge_minor, courier_variance_minor, delivery_currency
FROM delivery_provider_dispatch_0056_legacy;

CREATE INDEX delivery_provider_dispatch_status_updated_idx
  ON delivery_provider_dispatch(status, updated_at, id);
CREATE INDEX delivery_provider_dispatch_provider_status_idx
  ON delivery_provider_dispatch(provider, provider_status, updated_at, id);

CREATE TABLE delivery_provider_event_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('grab-express', 'lalamove')),
  provider_event_id TEXT NOT NULL,
  dispatch_id TEXT REFERENCES delivery_provider_dispatch(id) ON DELETE RESTRICT,
  provider_delivery_id TEXT NOT NULL,
  merchant_order_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  provider_status TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL CHECK (length(raw_payload) <= 65536),
  processing_status TEXT NOT NULL CHECK (
    processing_status IN ('RECEIVED', 'APPLIED', 'RECONCILIATION_REQUIRED')
  ),
  last_error_code TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  UNIQUE(provider, provider_event_id)
);

INSERT INTO delivery_provider_event_inbox
SELECT * FROM delivery_provider_event_inbox_0056_legacy;

CREATE INDEX delivery_provider_event_inbox_processing_idx
  ON delivery_provider_event_inbox(processing_status, received_at, id);
CREATE INDEX delivery_provider_event_inbox_delivery_idx
  ON delivery_provider_event_inbox(provider, provider_delivery_id, observed_at, id);

DROP TABLE delivery_provider_event_inbox_0056_legacy;
DROP TABLE delivery_provider_dispatch_0056_legacy;

CREATE TRIGGER delivery_provider_dispatch_finance_insert_guard
BEFORE INSERT ON delivery_provider_dispatch
WHEN
  (NEW.final_payable_minor IS NOT NULL
   OR NEW.customer_delivery_charge_minor IS NOT NULL
   OR NEW.courier_variance_minor IS NOT NULL
   OR NEW.delivery_currency IS NOT NULL)
  AND NOT (
    NEW.final_payable_minor IS NOT NULL
    AND NEW.customer_delivery_charge_minor IS NOT NULL
    AND NEW.courier_variance_minor =
      NEW.final_payable_minor - NEW.customer_delivery_charge_minor
    AND NEW.delivery_currency IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DELIVERY_FINANCIAL_EVIDENCE');
END;

CREATE TRIGGER delivery_provider_dispatch_finance_update_guard
BEFORE UPDATE OF final_payable_minor, customer_delivery_charge_minor,
  courier_variance_minor, delivery_currency
ON delivery_provider_dispatch
WHEN
  (NEW.final_payable_minor IS NOT NULL
   OR NEW.customer_delivery_charge_minor IS NOT NULL
   OR NEW.courier_variance_minor IS NOT NULL
   OR NEW.delivery_currency IS NOT NULL)
  AND NOT (
    NEW.final_payable_minor IS NOT NULL
    AND NEW.customer_delivery_charge_minor IS NOT NULL
    AND NEW.courier_variance_minor =
      NEW.final_payable_minor - NEW.customer_delivery_charge_minor
    AND NEW.delivery_currency IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DELIVERY_FINANCIAL_EVIDENCE');
END;
