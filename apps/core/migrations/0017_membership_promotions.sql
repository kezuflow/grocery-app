-- 0017_membership_promotions.sql
-- Canonical Membership lifecycle and Promotions-owned introductory trial.
-- Additive only; historical trial subscriptions keep their recorded timestamps.

ALTER TABLE subscription_offer ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'CALENDAR_MONTH'
  CHECK (billing_interval IN ('CALENDAR_MONTH'));

-- The legacy 14-day TRIAL offer keeps its history but loses default authority.
UPDATE subscription_offer SET is_default = 0, status = 'legacy' WHERE code = 'TRIAL';

-- Canonical paid membership. trial_days=0 satisfies the legacy non-null column;
-- application code must never read it for authorization or arithmetic.
INSERT INTO subscription_offer (id, code, name, fee_minor, currency, trial_days, status, is_default, billing_interval)
VALUES ('offer-membership-monthly', 'MEMBERSHIP_MONTHLY', 'FreshMarkets Membership', 29900, 'PHP', 0, 'active', 1, 'CALENDAR_MONTH')
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  fee_minor = excluded.fee_minor,
  currency = excluded.currency,
  trial_days = 0,
  status = 'active',
  is_default = 1,
  billing_interval = 'CALENDAR_MONTH';

-- Lifecycle metadata for the subscription aggregate.
ALTER TABLE subscription ADD COLUMN billing_starts_at INTEGER;
ALTER TABLE subscription ADD COLUMN current_period_starts_at INTEGER;
ALTER TABLE subscription ADD COLUMN current_period_ends_at INTEGER;
ALTER TABLE subscription ADD COLUMN paused_at INTEGER;
ALTER TABLE subscription ADD COLUMN resume_at INTEGER;
ALTER TABLE subscription ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0
  CHECK (cancel_at_period_end IN (0, 1));
ALTER TABLE subscription ADD COLUMN cancellation_requested_at INTEGER;
ALTER TABLE subscription ADD COLUMN scheduled_cancellation_at INTEGER;
ALTER TABLE subscription ADD COLUMN ended_at INTEGER;

-- Normalize any historical noncanonical spelling to CANCELED (never reverse).
UPDATE subscription SET status = 'CANCELED' WHERE status = 'CANCELLED';

-- One open subscription per customer across all entitled states.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_one_open_per_customer_idx
  ON subscription(customer_id)
  WHERE status IN ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED');

-- Subscription lifecycle evidence referencing application-owned identities only.
CREATE TABLE IF NOT EXISTS subscription_event (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscription(id),
  event_type TEXT NOT NULL,
  payment_intent_id TEXT REFERENCES payment_intent(id),
  promotion_redemption_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'SYSTEM',
  details_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS subscription_event_subscription_time_idx
  ON subscription_event(subscription_id, occurred_at);

-- Promotions owns introductory-trial authority through grant/redemption.
CREATE TABLE IF NOT EXISTS promotion_grant (
  id TEXT PRIMARY KEY,
  benefit_code TEXT NOT NULL,
  benefit_type TEXT NOT NULL CHECK (benefit_type IN ('MEMBERSHIP_FEE_WAIVER','ORDER_PERCENT_DISCOUNT','ORDER_FIXED_DISCOUNT','DELIVERY_FEE_WAIVER','DELIVERY_FEE_DISCOUNT')),
  max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions >= 1),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','EXHAUSTED','REVOKED')),
  parameters_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_redemption (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES promotion_grant(id),
  benefit_code TEXT NOT NULL,
  benefit_type TEXT NOT NULL CHECK (benefit_type IN ('MEMBERSHIP_FEE_WAIVER','ORDER_PERCENT_DISCOUNT','ORDER_FIXED_DISCOUNT','DELIVERY_FEE_WAIVER','DELIVERY_FEE_DISCOUNT')),
  customer_id TEXT NOT NULL REFERENCES customer(id),
  subject_type TEXT,
  subject_id TEXT,
  redeemed_at INTEGER NOT NULL
);

-- One introductory trial redemption per customer, independent of offer metadata.
CREATE UNIQUE INDEX IF NOT EXISTS promotion_redemption_one_intro_trial_per_customer_idx
  ON promotion_redemption(benefit_code, customer_id)
  WHERE benefit_code = 'INTRO_TRIAL';

CREATE INDEX IF NOT EXISTS promotion_redemption_customer_idx
  ON promotion_redemption(customer_id, redeemed_at);

CREATE INDEX IF NOT EXISTS promotion_grant_status_idx
  ON promotion_grant(status, benefit_code);

-- System grant authorizing the introductory calendar-month trial. Eligibility
-- and consumption are enforced through promotion_redemption uniqueness.
INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, parameters_json, created_at, updated_at)
VALUES ('grant-introductory-trial', 'INTRO_TRIAL', 'MEMBERSHIP_FEE_WAIVER', 1000000, 'ACTIVE',
        '{"duration":"CALENDAR_MONTH","scope":"MEMBERSHIP"}', 0, 0);

-- Historical backfill: mark existing trial subscriptions as legacy history with
-- their actual stored timestamps; durations are not rewritten.
INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, parameters_json, created_at, updated_at)
SELECT 'grant-legacy-trial-history', 'LEGACY_TRIAL_HISTORY', 'MEMBERSHIP_FEE_WAIVER', 1, 'EXHAUSTED',
       '{"historical":true}', COALESCE(MIN(starts_at), 0), COALESCE(MIN(starts_at), 0)
FROM subscription WHERE status = 'TRIALING' OR trial_ends_at IS NOT NULL;

INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, subject_type, subject_id, redeemed_at)
SELECT 'legacy-' || s.id, 'grant-legacy-trial-history', 'LEGACY_TRIAL_HISTORY', 'MEMBERSHIP_FEE_WAIVER',
       s.customer_id, 'subscription', s.id, COALESCE(s.starts_at, 0)
FROM subscription s
WHERE s.status = 'TRIALING' OR s.trial_ends_at IS NOT NULL;
