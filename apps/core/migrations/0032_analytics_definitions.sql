-- Versioned, application-owned Analytics metadata. Formula JSON is descriptive
-- only; Core maps these immutable seed codes to closed named query functions.
CREATE TABLE metric_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'CUSTOMERS', 'ORDERS', 'MEMBERSHIPS', 'PROMOTIONS',
    'FULFILLMENT', 'DELIVERY', 'INVENTORY', 'FINANCE'
  )),
  formula_json TEXT NOT NULL CHECK (json_valid(formula_json)),
  dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dimensions_json)),
  source_contract_version TEXT NOT NULL,
  event_time_field TEXT NOT NULL,
  reporting_timezone_policy TEXT NOT NULL,
  inclusion_json TEXT NOT NULL CHECK (json_valid(inclusion_json)),
  exclusion_json TEXT NOT NULL CHECK (json_valid(exclusion_json)),
  rounding_policy TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPROVED', 'BLOCKED')),
  unavailable_reason TEXT NULL,
  approved_at INTEGER NULL,
  UNIQUE(code, version)
);

CREATE INDEX metric_definitions_code_status_version_idx
  ON metric_definitions(code, status, version DESC);

CREATE UNIQUE INDEX metric_definitions_one_approved_code_idx
  ON metric_definitions(code) WHERE status = 'APPROVED';

INSERT INTO metric_definitions (
  id, code, version, display_name, category, formula_json, source_contract_version,
  event_time_field, reporting_timezone_policy, inclusion_json, exclusion_json,
  rounding_policy, status, approved_at
) VALUES
  ('metric-definition-order-count-v1', 'order_count', 1, 'Order count', 'ORDERS', '{"description":"Count Orders by first successful commitment instant."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"event":"first_successful_commitment"}', '{"amendments":"not additional Orders"}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-refund-amount-v1', 'refund_amount', 1, 'Refund amount', 'FINANCE', '{"description":"Sum successful Refund amounts by refund-success instant and currency."}', '2026-08-29.admin-analytics-slice-8', 'refund_succeeded_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"refundStatus":"SUCCEEDED"}', '{"currencies":"never silently combined"}', 'MINOR_UNITS_BY_CURRENCY', 'APPROVED', 1787961600000),
  ('metric-definition-new-customers-v1', 'new_customers', 1, 'New customers', 'CUSTOMERS', '{"description":"Count Customer aggregates created in the reporting window."}', '2026-08-29.admin-analytics-slice-8', 'customer_created_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-active-customers-v1', 'active_customers', 1, 'Active customers', 'CUSTOMERS', '{"description":"Count distinct Customers with a first Order commitment instant in the reporting window."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"event":"first_successful_commitment"}', '{}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-repeat-customer-rate-v1', 'repeat_customer_rate', 1, 'Repeat customer rate', 'CUSTOMERS', '{"description":"Active Customers with a prior committed Order divided by active Customers."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"denominator":"active_customers"}', '{"emptyDenominator":"null"}', 'RATIO', 'APPROVED', 1787961600000),
  ('metric-definition-orders-per-customer-v1', 'orders_per_customer', 1, 'Orders per customer', 'CUSTOMERS', '{"description":"Order count divided by active Customers."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"denominator":"active_customers"}', '{"emptyDenominator":"null"}', 'RATIO', 'APPROVED', 1787961600000),
  ('metric-definition-active-members-v1', 'active_members', 1, 'Active members', 'MEMBERSHIPS', '{"description":"Point-in-time count of effective ACTIVE subscriptions."}', '2026-08-29.admin-analytics-slice-8', 'subscription_effective_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"subscriptionState":"ACTIVE"}', '{}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-trialing-members-v1', 'trialing_members', 1, 'Trialing members', 'MEMBERSHIPS', '{"description":"Point-in-time count of effective TRIALING subscriptions."}', '2026-08-29.admin-analytics-slice-8', 'subscription_effective_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"subscriptionState":"TRIALING"}', '{}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-promotion-redemptions-v1', 'promotion_redemptions', 1, 'Promotion redemptions', 'PROMOTIONS', '{"description":"Count Promotion redemption records by redeemedAt."}', '2026-08-29.admin-analytics-slice-8', 'redeemed_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{}', 'INTEGER', 'APPROVED', 1787961600000),
  ('metric-definition-discount-spend-v1', 'discount_spend', 1, 'Discount spend', 'PROMOTIONS', '{"description":"Sum snapshotted applied benefit amounts by component and currency."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"components":["merchandise","delivery","membership_fee"]}', '{"currencies":"never silently combined"}', 'MINOR_UNITS_BY_CURRENCY', 'APPROVED', 1787961600000),
  ('metric-definition-promotion-influenced-order-revenue-v1', 'promotion_influenced_order_revenue', 1, 'Promotion-influenced Order revenue', 'PROMOTIONS', '{"description":"Sum committed Order final totals with an Order or delivery Promotion redemption."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"promotionBenefit":"ORDER_OR_DELIVERY"}', '{"causalAttribution":"not implied"}', 'MINOR_UNITS_BY_CURRENCY', 'APPROVED', 1787961600000),
  ('metric-definition-fulfillment-time-v1', 'fulfillment_time', 1, 'Fulfillment time', 'FULFILLMENT', '{"description":"fulfillmentCompletedAt minus committedAt for completed fulfillments."}', '2026-08-29.admin-analytics-slice-8', 'fulfillment_completed_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"fulfillmentStatus":"COMPLETED"}', '{}', 'DURATION_MILLISECONDS', 'APPROVED', 1787961600000),
  ('metric-definition-picking-time-v1', 'picking_time', 1, 'Picking time', 'FULFILLMENT', '{"description":"pickingCompletedAt minus pickingStartedAt where both events exist."}', '2026-08-29.admin-analytics-slice-8', 'picking_completed_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"requiredEvents":["picking_started_at","picking_completed_at"]}', '{}', 'DURATION_MILLISECONDS', 'APPROVED', 1787961600000),
  ('metric-definition-packing-time-v1', 'packing_time', 1, 'Packing time', 'FULFILLMENT', '{"description":"packedAt minus packingStartedAt where both events exist."}', '2026-08-29.admin-analytics-slice-8', 'packed_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"requiredEvents":["packing_started_at","packed_at"]}', '{}', 'DURATION_MILLISECONDS', 'APPROVED', 1787961600000),
  ('metric-definition-delivery-time-v1', 'delivery_time', 1, 'Delivery time', 'DELIVERY', '{"description":"deliveredAt minus dispatchedAt for delivered jobs."}', '2026-08-29.admin-analytics-slice-8', 'delivered_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"deliveryStatus":"DELIVERED"}', '{}', 'DURATION_MILLISECONDS', 'APPROVED', 1787961600000),
  ('metric-definition-late-delivery-rate-v1', 'late_delivery_rate', 1, 'Late-delivery rate', 'DELIVERY', '{"description":"Late or unresolved past-promise jobs divided by elapsed-promise jobs."}', '2026-08-29.admin-analytics-slice-8', 'promised_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"denominator":"elapsed promised jobs"}', '{"emptyDenominator":"null"}', 'RATIO', 'APPROVED', 1787961600000),
  ('metric-definition-cancellation-rate-v1', 'cancellation_rate', 1, 'Cancellation rate', 'ORDERS', '{"description":"Canceled Orders divided by the first-commitment cohort."}', '2026-08-29.admin-analytics-slice-8', 'first_successful_commitment_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"denominator":"order_count"}', '{"emptyDenominator":"null"}', 'RATIO', 'APPROVED', 1787961600000),
  ('metric-definition-out-of-stock-rate-v1', 'out_of_stock_rate', 1, 'Out-of-stock rate', 'INVENTORY', '{"description":"Insufficient-stock rejections divided by active-SKU availability checks."}', '2026-08-29.admin-analytics-slice-8', 'availability_evaluated_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"activeSku":true}', '{"instrumentation":"required"}', 'RATIO', 'APPROVED', 1787961600000),
  ('metric-definition-stockouts-v1', 'stockouts', 1, 'Stockouts', 'INVENTORY', '{"description":"Count usable inventory transitions from above zero to zero."}', '2026-08-29.admin-analytics-slice-8', 'ledger_created_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"transition":"positive_to_zero"}', '{"deduplication":"ledger transition"}', 'INTEGER_BY_BASE_UNIT', 'APPROVED', 1787961600000),
  ('metric-definition-inventory-adjustments-shrinkage-v1', 'inventory_adjustments_shrinkage', 1, 'Inventory adjustments/shrinkage', 'INVENTORY', '{"description":"Sum signed adjustment ledger movements by unit, location, and reason."}', '2026-08-29.admin-analytics-slice-8', 'ledger_created_at', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{"ledgerKind":"ADJUSTMENT"}', '{"baseUnits":"never silently combined"}', 'SIGNED_BASE_UNITS', 'APPROVED', 1787961600000),
  ('metric-definition-gmv-v1', 'gmv', 1, 'GMV', 'FINANCE', '{"description":"Gross merchandise value under an approved accounting definition."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-revenue-net-sales-v1', 'revenue_net_sales', 1, 'Revenue/net sales', 'FINANCE', '{"description":"Net sales under an approved accounting definition."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-average-order-value-v1', 'average_order_value', 1, 'AOV', 'FINANCE', '{"description":"Average order value under an approved accounting definition."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-refund-rate-v1', 'refund_rate', 1, 'Refund rate', 'FINANCE', '{"description":"Refund rate under an approved accounting definition."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-trial-to-paid-conversion-v1', 'trial_to_paid_conversion', 1, 'Trial-to-paid conversion', 'MEMBERSHIPS', '{"description":"Trial cohort conversion to paid membership."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-monthly-recurring-revenue-v1', 'monthly_recurring_revenue', 1, 'MRR', 'MEMBERSHIPS', '{"description":"Monthly recurring revenue."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-churn-v1', 'churn', 1, 'Churn', 'MEMBERSHIPS', '{"description":"Membership churn."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-promotion-redemption-rate-v1', 'promotion_redemption_rate', 1, 'Promotion redemption rate', 'PROMOTIONS', '{"description":"Promotion redemptions divided by an approved denominator."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-substitution-rate-v1', 'substitution_rate', 1, 'Substitution rate', 'FULFILLMENT', '{"description":"Substitutions divided by an approved denominator."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL),
  ('metric-definition-inventory-turnover-v1', 'inventory_turnover', 1, 'Inventory turnover', 'INVENTORY', '{"description":"Inventory turnover over an approved period basis."}', '2026-08-29.admin-analytics-slice-8', 'unresolved', 'EXPLICIT_IANA_REQUEST_TIMEZONE', '{}', '{"blocked":true}', 'UNAVAILABLE', 'BLOCKED', NULL);

UPDATE metric_definitions
SET dimensions_json = CASE code
  WHEN 'order_count' THEN '["marketId","locationId"]'
  WHEN 'refund_amount' THEN '["marketId","locationId","currency"]'
  WHEN 'new_customers' THEN '["marketId","locationId"]'
  WHEN 'active_customers' THEN '["marketId","locationId"]'
  WHEN 'repeat_customer_rate' THEN '["marketId","locationId"]'
  WHEN 'orders_per_customer' THEN '["marketId","locationId"]'
  WHEN 'active_members' THEN '["marketId","locationId"]'
  WHEN 'trialing_members' THEN '["marketId","locationId"]'
  WHEN 'promotion_redemptions' THEN '["marketId","locationId","promotionId","promotionBenefitType"]'
  WHEN 'discount_spend' THEN '["marketId","locationId","currency","promotionBenefitType"]'
  WHEN 'promotion_influenced_order_revenue' THEN '["marketId","locationId","currency","promotionId"]'
  WHEN 'fulfillment_time' THEN '["marketId","locationId"]'
  WHEN 'picking_time' THEN '["marketId","locationId"]'
  WHEN 'packing_time' THEN '["marketId","locationId"]'
  WHEN 'delivery_time' THEN '["marketId","locationId"]'
  WHEN 'late_delivery_rate' THEN '["marketId","locationId"]'
  WHEN 'cancellation_rate' THEN '["marketId","locationId"]'
  WHEN 'out_of_stock_rate' THEN '["marketId","locationId"]'
  WHEN 'stockouts' THEN '["marketId","locationId","baseUnit"]'
  WHEN 'inventory_adjustments_shrinkage' THEN '["marketId","locationId","baseUnit","inventoryAdjustmentReason"]'
  WHEN 'gmv' THEN '["marketId","locationId","currency"]'
  WHEN 'revenue_net_sales' THEN '["marketId","locationId","currency"]'
  WHEN 'average_order_value' THEN '["marketId","locationId","currency"]'
  WHEN 'refund_rate' THEN '["marketId","locationId","currency"]'
  WHEN 'trial_to_paid_conversion' THEN '["marketId","locationId"]'
  WHEN 'monthly_recurring_revenue' THEN '["marketId","locationId","currency"]'
  WHEN 'churn' THEN '["marketId","locationId"]'
  WHEN 'promotion_redemption_rate' THEN '["marketId","locationId","promotionId"]'
  WHEN 'substitution_rate' THEN '["marketId","locationId"]'
  WHEN 'inventory_turnover' THEN '["marketId","locationId","baseUnit"]'
END,
unavailable_reason = CASE code
  WHEN 'gmv' THEN 'Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.'
  WHEN 'revenue_net_sales' THEN 'Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.'
  WHEN 'average_order_value' THEN 'Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.'
  WHEN 'refund_rate' THEN 'Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.'
  WHEN 'trial_to_paid_conversion' THEN 'Requires an approved cohort and conversion-window definition.'
  WHEN 'monthly_recurring_revenue' THEN 'Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.'
  WHEN 'churn' THEN 'Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.'
  WHEN 'promotion_redemption_rate' THEN 'Requires an approved promotion-redemption denominator.'
  WHEN 'substitution_rate' THEN 'Unavailable while substitutions are out of scope.'
  WHEN 'inventory_turnover' THEN 'Deferred until its cost and period basis is approved.'
END;

CREATE TRIGGER metric_definitions_no_update
BEFORE UPDATE ON metric_definitions
BEGIN
  SELECT RAISE(ABORT, 'metric definitions are immutable');
END;

CREATE TRIGGER metric_definitions_no_delete
BEFORE DELETE ON metric_definitions
BEGIN
  SELECT RAISE(ABORT, 'metric definitions are immutable');
END;
