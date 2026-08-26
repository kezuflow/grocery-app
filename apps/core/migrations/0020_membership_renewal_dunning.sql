-- 0020_membership_renewal_dunning.sql
-- Program 3: Payments-owned recurring authorization aggregate and Membership
-- renewal/dunning columns. Additive only; existing subscriptions keep nulls.

CREATE TABLE IF NOT EXISTS payment_authorization (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  provider TEXT NOT NULL,
  provider_authorization_ref TEXT NOT NULL,
  provider_method_ref TEXT,
  recurring_capable INTEGER NOT NULL DEFAULT 0 CHECK (recurring_capable IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  established_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_authorization_ref)
);

-- One live mandate identity per provider instrument; revoked authorizations
-- may be re-established, while trial-abuse checks join through subscriptions.
CREATE UNIQUE INDEX IF NOT EXISTS payment_authorization_method_identity_idx
  ON payment_authorization(provider, provider_method_ref)
  WHERE provider_method_ref IS NOT NULL AND status IN ('PENDING', 'ACTIVE');

CREATE INDEX IF NOT EXISTS payment_authorization_customer_idx
  ON payment_authorization(customer_id, status);

ALTER TABLE subscription ADD COLUMN payment_authorization_id TEXT REFERENCES payment_authorization(id);
ALTER TABLE subscription ADD COLUMN grace_ends_at INTEGER;
ALTER TABLE subscription ADD COLUMN nominal_billing_day INTEGER
  CHECK (nominal_billing_day IS NULL OR nominal_billing_day BETWEEN 1 AND 31);
ALTER TABLE subscription ADD COLUMN renewal_initiated_through INTEGER;

CREATE INDEX IF NOT EXISTS subscription_renewal_due_idx
  ON subscription(status, trial_ends_at, current_period_ends_at);

CREATE INDEX IF NOT EXISTS subscription_event_payment_intent_idx
  ON subscription_event(payment_intent_id);
