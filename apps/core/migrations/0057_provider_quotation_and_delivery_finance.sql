-- Provider quotations are immutable commercial evidence. Checkout-owned rows
-- price customer delivery; delivery-job-owned rows capture the later booking
-- quotation without changing the customer charge.

CREATE TABLE delivery_provider_quotation (
  id TEXT PRIMARY KEY NOT NULL,
  checkout_attempt_id TEXT REFERENCES checkout_attempts(id) ON DELETE RESTRICT,
  delivery_job_id TEXT REFERENCES delivery_job(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_service TEXT NOT NULL,
  provider_quotation_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  quoted_at INTEGER NOT NULL,
  expires_at INTEGER,
  scheduled_pickup_at INTEGER,
  origin_snapshot_json TEXT NOT NULL,
  destination_snapshot_json TEXT NOT NULL,
  capability_snapshot_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('ACTIVE', 'SELECTED', 'EXPIRED', 'SUPERSEDED', 'FAILED')
  ),
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_quotation_id),
  CHECK (
    (checkout_attempt_id IS NOT NULL AND delivery_job_id IS NULL) OR
    (checkout_attempt_id IS NULL AND delivery_job_id IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR expires_at > quoted_at)
);

CREATE INDEX delivery_provider_quotation_checkout_idx
  ON delivery_provider_quotation(checkout_attempt_id, status, quoted_at, id);
CREATE INDEX delivery_provider_quotation_job_idx
  ON delivery_provider_quotation(delivery_job_id, status, quoted_at, id);

CREATE TRIGGER delivery_provider_quotation_evidence_update_guard
BEFORE UPDATE OF checkout_attempt_id, delivery_job_id, provider,
  provider_service, provider_quotation_id, amount_minor, currency, quoted_at,
  expires_at, scheduled_pickup_at, origin_snapshot_json,
  destination_snapshot_json, capability_snapshot_json, request_hash, created_at
ON delivery_provider_quotation
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROVIDER_QUOTATION_EVIDENCE');
END;

CREATE TRIGGER delivery_provider_quotation_delete_guard
BEFORE DELETE ON delivery_provider_quotation
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROVIDER_QUOTATION_EVIDENCE');
END;

ALTER TABLE checkout_attempts
  ADD COLUMN fulfillment_configuration_id TEXT
  REFERENCES global_commerce_configuration(id);
UPDATE checkout_attempts
SET fulfillment_configuration_id = 'global'
WHERE fulfillment_configuration_id IS NULL;

ALTER TABLE checkout_quote
  ADD COLUMN provider_quotation_snapshot_json TEXT;

ALTER TABLE checkout_quote_snapshots
  ADD COLUMN merchandise_subtotal_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN item_discount_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN order_discount_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN delivery_discount_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN tax_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN final_total_minor INTEGER;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN promotion_snapshot_json TEXT;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN fulfillment_snapshot_json TEXT;
ALTER TABLE checkout_quote_snapshots
  ADD COLUMN provider_quotation_snapshot_json TEXT;

UPDATE checkout_quote_snapshots
SET merchandise_subtotal_minor = merchandise_minor,
    item_discount_minor = discount_minor,
    order_discount_minor = 0,
    delivery_discount_minor = 0,
    tax_minor = 0,
    final_total_minor = total_minor,
    promotion_snapshot_json = '{"version":1,"source":"legacy","applications":[]}',
    fulfillment_snapshot_json = '{"version":1,"source":"legacy"}'
WHERE merchandise_subtotal_minor IS NULL;

ALTER TABLE order_fulfillment_snapshot
  ADD COLUMN provider_quotation_snapshot_json TEXT;
ALTER TABLE order_fulfillment_snapshot
  ADD COLUMN delivery_execution_snapshot_json TEXT;
ALTER TABLE order_fulfillment_snapshot
  ADD COLUMN checkout_delivery_charge_minor INTEGER
  CHECK (checkout_delivery_charge_minor IS NULL OR checkout_delivery_charge_minor >= 0);

UPDATE order_fulfillment_snapshot
SET checkout_delivery_charge_minor = (
  SELECT orders.delivery_subtotal_minor
  FROM grocery_order orders
  WHERE orders.id = order_fulfillment_snapshot.order_id
)
WHERE checkout_delivery_charge_minor IS NULL;

ALTER TABLE delivery_provider_dispatch
  ADD COLUMN checkout_quotation_id TEXT
  REFERENCES delivery_provider_quotation(id);
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN final_quotation_id TEXT
  REFERENCES delivery_provider_quotation(id);
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN pickup_timing TEXT
  CHECK (pickup_timing IS NULL OR pickup_timing IN ('IMMEDIATE', 'SCHEDULED'));
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN scheduled_pickup_at INTEGER;
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN final_payable_minor INTEGER
  CHECK (final_payable_minor IS NULL OR final_payable_minor >= 0);
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN customer_delivery_charge_minor INTEGER
  CHECK (customer_delivery_charge_minor IS NULL OR customer_delivery_charge_minor >= 0);
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN courier_variance_minor INTEGER;
ALTER TABLE delivery_provider_dispatch
  ADD COLUMN delivery_currency TEXT
  CHECK (delivery_currency IS NULL OR length(delivery_currency) = 3);

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
