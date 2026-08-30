-- Global effective-dated Membership pricing and the Instant-only
-- FreshMarkets Service Fee. Existing subscriptions retain an agreed snapshot;
-- no Service Fee is guessed or seeded by this migration.

CREATE TABLE membership_price_version (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES subscription_offer(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by_staff_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE(offer_id, version)
);

CREATE UNIQUE INDEX membership_price_version_current_unique
  ON membership_price_version(offer_id)
  WHERE effective_to IS NULL;
CREATE INDEX membership_price_version_effective_idx
  ON membership_price_version(effective_from, effective_to);

INSERT INTO membership_price_version (
  id, offer_id, amount_minor, currency, effective_from, effective_to,
  version, created_by_staff_id, created_at
)
SELECT
  'membership-price-version-1', id, fee_minor, currency, 0, NULL,
  1, NULL, 0
FROM subscription_offer
WHERE code = 'MEMBERSHIP_MONTHLY';

ALTER TABLE subscription ADD COLUMN agreed_price_version_id TEXT
  REFERENCES membership_price_version(id);
ALTER TABLE subscription ADD COLUMN agreed_amount_minor INTEGER
  CHECK (agreed_amount_minor IS NULL OR agreed_amount_minor > 0);
ALTER TABLE subscription ADD COLUMN agreed_currency TEXT
  CHECK (agreed_currency IS NULL OR length(agreed_currency) = 3);

UPDATE subscription
SET agreed_price_version_id = 'membership-price-version-1',
    agreed_amount_minor = (
      SELECT amount_minor FROM membership_price_version
      WHERE id = 'membership-price-version-1'
    ),
    agreed_currency = (
      SELECT currency FROM membership_price_version
      WHERE id = 'membership-price-version-1'
    )
WHERE EXISTS (
  SELECT 1 FROM membership_price_version
  WHERE id = 'membership-price-version-1'
);

CREATE TABLE service_fee_configuration (
  id TEXT PRIMARY KEY,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('FLAT','PERCENTAGE','MIXED')),
  flat_minor INTEGER NOT NULL CHECK (flat_minor >= 0),
  percentage_basis_points INTEGER NOT NULL
    CHECK (percentage_basis_points BETWEEN 0 AND 10000),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  version INTEGER NOT NULL UNIQUE CHECK (version >= 1),
  created_by_staff_id TEXT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at INTEGER NOT NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (
    (fee_type = 'FLAT' AND flat_minor > 0 AND percentage_basis_points = 0)
    OR (fee_type = 'PERCENTAGE' AND flat_minor = 0 AND percentage_basis_points > 0)
    OR (fee_type = 'MIXED' AND flat_minor > 0 AND percentage_basis_points > 0)
  )
);

CREATE UNIQUE INDEX service_fee_configuration_current_unique
  ON service_fee_configuration((1))
  WHERE effective_to IS NULL;
CREATE INDEX service_fee_configuration_effective_idx
  ON service_fee_configuration(effective_from, effective_to);

ALTER TABLE checkout_quote ADD COLUMN pre_service_fee_total_minor INTEGER NOT NULL DEFAULT 0
  CHECK (pre_service_fee_total_minor >= 0);
ALTER TABLE checkout_quote ADD COLUMN service_fee_configuration_id TEXT
  REFERENCES service_fee_configuration(id);
ALTER TABLE checkout_quote ADD COLUMN service_fee_snapshot_json TEXT;

UPDATE checkout_quote
SET pre_service_fee_total_minor = total_minor - service_fee_minor;

ALTER TABLE grocery_order ADD COLUMN pre_service_fee_total_minor INTEGER NOT NULL DEFAULT 0
  CHECK (pre_service_fee_total_minor >= 0);
ALTER TABLE grocery_order ADD COLUMN service_fee_configuration_id TEXT
  REFERENCES service_fee_configuration(id);
ALTER TABLE grocery_order ADD COLUMN service_fee_snapshot_json TEXT;

UPDATE grocery_order
SET pre_service_fee_total_minor = total_minor - service_fee_minor;
