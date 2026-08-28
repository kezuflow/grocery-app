-- Promotion administration: rebuild the historical fixed-discount seam into
-- the canonical promotion definition shape. Legacy rows are copied additively
-- as ACTIVE ORDER_FIXED_DISCOUNT definitions; history is preserved.
--
-- The introductory-trial authority (promotion_grant/promotion_redemption with
-- benefit_code INTRO_TRIAL) is untouched and MEMBERSHIP_FEE_WAIVER is never
-- creatable through this surface.

CREATE TABLE IF NOT EXISTS promotion_admin (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  benefit_type TEXT NOT NULL CHECK (benefit_type IN ('ORDER_FIXED_DISCOUNT', 'ORDER_PERCENT_DISCOUNT', 'DELIVERY_FEE_WAIVER', 'DELIVERY_FEE_DISCOUNT')),
  discount_minor INTEGER,
  percent INTEGER,
  minimum_minor INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  global_usage_limit INTEGER,
  per_customer_usage_limit INTEGER,
  automatic INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (benefit_type != 'ORDER_FIXED_DISCOUNT' OR discount_minor IS NOT NULL),
  CHECK (benefit_type != 'ORDER_PERCENT_DISCOUNT' OR percent IS NOT NULL)
);

INSERT INTO promotion_admin
  (id, code, name, description, status, benefit_type, discount_minor, percent,
   minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit,
   automatic, priority, version, created_at, updated_at)
SELECT
  id, code, name, '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', discount_minor, NULL,
  minimum_minor, starts_at, ends_at, NULL, NULL,
  0, 0, 1, 0, 0
FROM promotion;

DROP TABLE promotion;
ALTER TABLE promotion_admin RENAME TO promotion;

ALTER TABLE promotion_grant ADD COLUMN customer_id TEXT REFERENCES customer(id);

CREATE INDEX IF NOT EXISTS promotion_status_idx ON promotion(status, starts_at);
