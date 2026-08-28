-- Additive repair for databases that already applied the original 0032
-- definition catalog. Definition metadata remains D1-authoritative.
ALTER TABLE metric_definitions
  ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dimensions_json));

ALTER TABLE metric_definitions
  ADD COLUMN unavailable_reason TEXT NULL;

-- Correct the initial definitions to their canonical first-successful-
-- commitment semantics while backfilling every DTO-required metadata field.
UPDATE metric_definitions
SET inclusion_json = CASE code
  WHEN 'order_count' THEN '{"event":"first_successful_commitment"}'
  WHEN 'active_customers' THEN '{"event":"first_successful_commitment"}'
  ELSE inclusion_json
END,
dimensions_json = CASE code
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

-- Slice 8 has no runtime definition-publication command. A future approved
-- version must arrive in a reviewed additive migration that deliberately
-- replaces this immutable catalog atomically; direct runtime publication is
-- rejected to preserve one active approved definition for each metric.
CREATE UNIQUE INDEX metric_definitions_one_approved_code_idx
  ON metric_definitions(code) WHERE status = 'APPROVED';

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
