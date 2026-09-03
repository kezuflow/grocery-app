CREATE TABLE delivery_provider_dispatch (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_job_id TEXT NOT NULL UNIQUE REFERENCES delivery_job(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('grab-express')),
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
  CHECK (
    (quote_amount_minor IS NULL AND quote_currency IS NULL)
    OR (quote_amount_minor IS NOT NULL AND quote_currency IS NOT NULL)
  ),
  CHECK (
    (provider_observed_at IS NULL AND provider_status_rank IS NULL)
    OR (provider_observed_at IS NOT NULL AND provider_status_rank IS NOT NULL)
  )
);

CREATE INDEX delivery_provider_dispatch_status_updated_idx
  ON delivery_provider_dispatch(status, updated_at, id);

CREATE INDEX delivery_provider_dispatch_provider_status_idx
  ON delivery_provider_dispatch(provider, provider_status, updated_at, id);

CREATE TABLE delivery_provider_event_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('grab-express')),
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

CREATE INDEX delivery_provider_event_inbox_processing_idx
  ON delivery_provider_event_inbox(processing_status, received_at, id);

CREATE INDEX delivery_provider_event_inbox_delivery_idx
  ON delivery_provider_event_inbox(provider, provider_delivery_id, observed_at, id);
