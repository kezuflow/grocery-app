-- Customer MVP completion: promotion quote/commit evidence, customer order
-- follow-up, additive amendments, notifications, and invoice-readiness seams.
-- All changes are additive and preserve Admin/Maps-owned migrations and data.

ALTER TABLE promotion ADD COLUMN maximum_discount_minor INTEGER
  CHECK (maximum_discount_minor IS NULL OR maximum_discount_minor >= 0);

CREATE TABLE promotion_rule (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotion(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'FIRST_ORDER', 'NEW_CUSTOMER', 'MEMBER', 'NON_MEMBER',
    'MINIMUM_SUBTOTAL', 'CUSTOMER_SEGMENT', 'SPECIFIC_CUSTOMERS'
  )),
  parameters_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX promotion_rule_definition_idx
  ON promotion_rule(promotion_id, sort_order, id);

CREATE TABLE customer_segment (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TABLE customer_segment_assignment (
  customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES customer_segment(id) ON DELETE CASCADE,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY(customer_id, segment_id)
);

ALTER TABLE checkout_quote ADD COLUMN requested_promotion_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE checkout_quote ADD COLUMN promotion_feedback_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE checkout_quote ADD COLUMN promotion_applications_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE checkout_quote ADD COLUMN price_acceptance_version INTEGER NOT NULL DEFAULT 1
  CHECK (price_acceptance_version >= 1);

CREATE TABLE checkout_promotion_claim (
  id TEXT PRIMARY KEY,
  checkout_quote_id TEXT NOT NULL REFERENCES checkout_quote(id) ON DELETE CASCADE,
  promotion_id TEXT NOT NULL REFERENCES promotion(id),
  customer_id TEXT NOT NULL REFERENCES customer(id),
  price_component TEXT NOT NULL CHECK (price_component IN ('MERCHANDISE', 'DELIVERY')),
  benefit_type TEXT NOT NULL CHECK (benefit_type IN (
    'ORDER_FIXED_DISCOUNT', 'ORDER_PERCENT_DISCOUNT',
    'DELIVERY_FEE_WAIVER', 'DELIVERY_FEE_DISCOUNT'
  )),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  definition_version INTEGER NOT NULL CHECK (definition_version >= 1),
  grant_id TEXT REFERENCES promotion_grant(id),
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNCOMMITTED' CHECK (status IN ('UNCOMMITTED', 'COMMITTED')),
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  UNIQUE(checkout_quote_id, price_component)
);
CREATE INDEX checkout_promotion_claim_definition_idx
  ON checkout_promotion_claim(promotion_id, status);

ALTER TABLE promotion_redemption ADD COLUMN promotion_id TEXT REFERENCES promotion(id);
ALTER TABLE promotion_redemption ADD COLUMN order_id TEXT REFERENCES grocery_order(id);
ALTER TABLE promotion_redemption ADD COLUMN amendment_id TEXT;
ALTER TABLE promotion_redemption ADD COLUMN price_component TEXT
  CHECK (price_component IS NULL OR price_component IN ('MEMBERSHIP', 'MERCHANDISE', 'DELIVERY'));
ALTER TABLE promotion_redemption ADD COLUMN amount_minor INTEGER
  CHECK (amount_minor IS NULL OR amount_minor >= 0);
ALTER TABLE promotion_redemption ADD COLUMN benefit_snapshot_json TEXT;
ALTER TABLE promotion_redemption ADD COLUMN eligibility_snapshot_json TEXT;
ALTER TABLE promotion_redemption ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX promotion_redemption_idempotency_unique
  ON promotion_redemption(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX promotion_redemption_definition_customer_idx
  ON promotion_redemption(promotion_id, customer_id, redeemed_at);

CREATE TABLE order_promotion_application (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id) ON DELETE CASCADE,
  amendment_id TEXT,
  promotion_id TEXT NOT NULL REFERENCES promotion(id),
  redemption_id TEXT NOT NULL REFERENCES promotion_redemption(id),
  price_component TEXT NOT NULL CHECK (price_component IN ('MERCHANDISE', 'DELIVERY')),
  benefit_type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  benefit_snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id, amendment_id, price_component)
);
CREATE UNIQUE INDEX order_promotion_application_component_unique
  ON order_promotion_application(order_id, IFNULL(amendment_id, ''), price_component);

ALTER TABLE grocery_order ADD COLUMN order_number TEXT;
ALTER TABLE grocery_order ADD COLUMN committed_at INTEGER;
CREATE UNIQUE INDEX grocery_order_number_unique
  ON grocery_order(order_number) WHERE order_number IS NOT NULL;

CREATE TABLE order_issue_line (
  issue_id TEXT NOT NULL REFERENCES order_issue(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_item(id),
  PRIMARY KEY(issue_id, order_item_id)
);

ALTER TABLE paid_order_amendment ADD COLUMN merchandise_subtotal_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN item_discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN order_discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN delivery_subtotal_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN delivery_discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN service_fee_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paid_order_amendment ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE paid_order_amendment ADD COLUMN committed_at INTEGER;

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL')),
  recipient_snapshot TEXT NOT NULL,
  template_data_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED')),
  scheduled_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  sent_at INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notification_outbox_due_idx
  ON notification_outbox(status, available_at, scheduled_at);

CREATE TABLE notification_attempt (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SENT', 'FAILED')),
  error_code TEXT,
  attempted_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX notification_attempt_message_idx
  ON notification_attempt(notification_id, attempted_at);

CREATE TABLE order_invoice_readiness (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES grocery_order(id) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL REFERENCES payment_attempt(id) ON DELETE RESTRICT,
  payment_intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intent(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PENDING_TAX_CONFIGURATION', 'READY_FOR_ISSUANCE', 'ISSUED')),
  invoice_identifier TEXT,
  issued_at INTEGER,
  seller_snapshot_json TEXT,
  buyer_snapshot_json TEXT NOT NULL,
  financial_snapshot_json TEXT NOT NULL,
  tax_breakdown_json TEXT,
  tax_policy_version TEXT,
  tax_classifications_json TEXT,
  external_reference TEXT,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    status != 'ISSUED' OR (
      invoice_identifier IS NOT NULL AND issued_at IS NOT NULL AND
      seller_snapshot_json IS NOT NULL AND tax_breakdown_json IS NOT NULL
    )
  )
);
