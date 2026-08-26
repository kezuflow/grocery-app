-- 0016_payments_context.sql
-- Provider-neutral Payments ownership: intents, provider mappings, a durable
-- signed provider-event inbox, explicit downstream reactions, reconciliation
-- cases, and non-synthetic refunds. Legacy payment_attempt/payment_event/refund
-- rows remain untouched historical compatibility data.

CREATE TABLE IF NOT EXISTS payment_intent (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('MEMBERSHIP_ENROLLMENT','MEMBERSHIP_RENEWAL','GROCERY_CHECKOUT','ORDER_AMENDMENT')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','EXPIRED','PARTIALLY_REFUNDED','REFUNDED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_intent_subject_idx
  ON payment_intent(subject_type, subject_id, status);

CREATE TABLE IF NOT EXISTS payment_provider_customer (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_customer_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_customer_ref)
);

CREATE TABLE IF NOT EXISTS payment_provider_method (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_method_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_method_ref)
);

CREATE TABLE IF NOT EXISTS payment_provider_event_inbox (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('RECEIVED','APPLIED','DUPLICATE','RETRY_REQUIRED','RECONCILIATION_REQUIRED','REJECTED')),
  last_error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_provider_event_inbox_status_idx
  ON payment_provider_event_inbox(processing_status, updated_at);

CREATE TABLE IF NOT EXISTS payment_reaction (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL REFERENCES payment_intent(id),
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('ACTIVATE_MEMBERSHIP','RECOVER_MEMBERSHIP','COMMIT_ORDER','COMMIT_AMENDMENT')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','ESCALATED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  available_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_reaction_pending_idx
  ON payment_reaction(status, available_at, updated_at);

CREATE TABLE IF NOT EXISTS payment_reconciliation_case (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT REFERENCES payment_intent(id),
  category TEXT NOT NULL CHECK (category IN ('UNMAPPED_PROVIDER_REFERENCE','AMBIGUOUS_OUTCOME','PROVIDER_TIMEOUT','REACTION_FAILURE','REFUND_UNRESOLVED')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_case_open_idx
  ON payment_reconciliation_case(status, created_at);

CREATE TABLE IF NOT EXISTS payment_refund (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL REFERENCES payment_intent(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','REJECTED','FAILED','ESCALATED')),
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_refund_reference TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_refund_intent_idx
  ON payment_refund(payment_intent_id, status);

ALTER TABLE payment_attempt ADD COLUMN payment_intent_id TEXT REFERENCES payment_intent(id);
