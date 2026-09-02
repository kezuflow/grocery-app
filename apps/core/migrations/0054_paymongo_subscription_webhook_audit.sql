-- Preserve the exact body of every signature-verified provider webhook for
-- financial audit and deterministic replay. Historical rows remain valid;
-- unverified requests never enter this inbox.

ALTER TABLE payment_provider_event_inbox ADD COLUMN raw_payload TEXT
  CHECK (raw_payload IS NULL OR length(CAST(raw_payload AS BLOB)) <= 262144);
ALTER TABLE payment_provider_event_inbox ADD COLUMN signature_verified_at INTEGER;

CREATE TABLE payment_provider_webhook_receipt (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  request_id TEXT NOT NULL,
  provider_event_id TEXT,
  event_type TEXT,
  payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL
    CHECK (length(CAST(raw_payload AS BLOB)) <= 262144),
  parse_status TEXT NOT NULL CHECK (parse_status IN ('PARSED','REJECTED_AFTER_VERIFICATION')),
  signature_verified_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX payment_provider_webhook_receipt_event_idx
  ON payment_provider_webhook_receipt(provider, provider_event_id, received_at);
CREATE INDEX payment_provider_webhook_receipt_received_idx
  ON payment_provider_webhook_receipt(received_at, provider);

-- PAUSED was an application-owned state that PayMongo scheduled
-- subscriptions do not expose. Preserve the row as intentionally ended
-- history instead of silently restoring access.
UPDATE subscription
SET status = 'CANCELED',
    ended_at = COALESCE(ended_at, unixepoch('now') * 1000),
    updated_at = unixepoch('now') * 1000,
    version = version + 1
WHERE status = 'PAUSED';

DROP INDEX IF EXISTS subscription_one_open_per_customer_idx;
CREATE UNIQUE INDEX subscription_one_open_per_customer_idx
  ON subscription(customer_id)
  WHERE status IN ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID');

-- Payments owns provider plan/subscription/invoice identities. Membership
-- continues to own the commercial agreement and entitlement state.
CREATE TABLE payment_provider_membership_plan (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  membership_price_version_id TEXT NOT NULL
    REFERENCES membership_price_version(id),
  provider_plan_reference TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  interval TEXT NOT NULL CHECK (interval IN ('WEEKLY','MONTHLY','YEARLY')),
  interval_count INTEGER NOT NULL CHECK (interval_count > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','INACTIVE','RECONCILIATION_REQUIRED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_plan_reference),
  UNIQUE(provider, membership_price_version_id)
);

CREATE TABLE payment_provider_subscription (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subscription_id TEXT NOT NULL UNIQUE REFERENCES subscription(id),
  customer_id TEXT NOT NULL REFERENCES customer(id),
  provider_subscription_reference TEXT NOT NULL,
  provider_plan_reference TEXT NOT NULL,
  provider_customer_reference TEXT,
  provider_status TEXT NOT NULL CHECK (
    provider_status IN (
      'INCOMPLETE','INCOMPLETE_CANCELED','ACTIVE','PAST_DUE','UNPAID','CANCELED'
    )
  ),
  latest_provider_event_id TEXT,
  latest_invoice_reference TEXT,
  next_billing_at INTEGER,
  provider_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subscription_reference)
);

CREATE INDEX payment_provider_subscription_status_idx
  ON payment_provider_subscription(provider, provider_status, updated_at);

CREATE TABLE payment_provider_subscription_invoice (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_invoice_reference TEXT NOT NULL,
  provider_subscription_reference TEXT NOT NULL,
  provider_payment_reference TEXT,
  provider_status TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  due_at INTEGER,
  paid_at INTEGER,
  latest_provider_event_id TEXT,
  provider_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_invoice_reference)
);

CREATE INDEX payment_provider_subscription_invoice_subscription_idx
  ON payment_provider_subscription_invoice(
    provider, provider_subscription_reference, created_at
  );
