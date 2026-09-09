-- Record first confirmation in the same guarded payment transaction. Retained
-- successful refunds without a reliable date stay unknown; do not invent dates
-- from their creation time or a later retry's updated_at.
ALTER TABLE payment_refund ADD COLUMN succeeded_at INTEGER
  CHECK (succeeded_at IS NULL OR succeeded_at BETWEEN -9007199254740991 AND 9007199254740991);

-- Purchase-based customer reports replace registration/current-payment-state
-- definitions. Keep old definitions readable but never run new SQL under them.
DROP TRIGGER metric_definitions_no_update;
UPDATE metric_definitions
SET status='SUPERSEDED', unavailable_reason='Superseded by approved purchase-based commerce reports.'
WHERE code IN ('order_count','new_customers','active_customers','refund_amount') AND status='APPROVED';

INSERT INTO metric_definitions
  (id,code,version,display_name,category,formula_json,source_contract_version,
   event_time_field,reporting_timezone_policy,inclusion_json,exclusion_json,
   rounding_policy,status,approved_at,dimensions_json,unavailable_reason)
VALUES
  ('metric-order-count-v2','order_count',2,'Paid Orders','ORDERS',
   '{"description":"Orders first committed in the selected period, including Orders later canceled or refunded."}',
   '2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"source":"immutable paid commitment"}','{"unpaid":true}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-new-customers-v2','new_customers',2,'New purchasing customers','CUSTOMERS',
   '{"description":"Customers whose first purchase occurred in the selected period and scope. Earlier purchases across all locations establish whether a customer is new; registrations do not count."}',
   '2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"source":"first paid commitment; equal timestamps ordered by Order ID"}','{"registrations":true}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-active-customers-v2','active_customers',2,'Unique purchasing customers','CUSTOMERS',
   '{"description":"Distinct customers with a purchase in the selected period and scope, including purchases later canceled or refunded."}',
   '2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"source":"immutable paid commitment"}','{"registrations":true}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-repeat-customers-v1','repeat_customers',1,'Returning purchasing customers','CUSTOMERS',
   '{"description":"Distinct customers with a repeat purchase in the selected period and scope. A previous purchase at any location qualifies, including earlier in the same period."}',
   '2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"source":"paid commitment with an earlier purchase"}','{"automatic_recurring_orders":true}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-repeat-orders-v1','repeat_orders',1,'Repeat purchases','CUSTOMERS',
   '{"description":"Purchases in the selected period and scope after the customer first purchased, including earlier purchases in the same period. This does not create recurring Orders or billing."}',
   '2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"source":"paid commitment with an earlier purchase"}','{"automatic_recurring_orders":true}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-received-amount-v1','received_amount',1,'Money received','FINANCE',
   '{"description":"Provider-confirmed payments by first confirmation date and currency, including paid additions and payments awaiting Order commitment. Global totals retain historical financial purposes; location totals cover grocery payments. Later refunds do not reduce this figure. This is not profit."}',
   '2026-09-10.commerce-reports','payment_reaction.created_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"global":"all retained financial purposes","location":"GROCERY_CHECKOUT and ORDER_AMENDMENT"}','{"unknown_dates_or_scope":"unavailable"}','MINOR_UNITS_BY_CURRENCY','APPROVED',1788998400000,'["marketId","locationId","currency"]',NULL),
  ('metric-refund-amount-v3','refund_amount',3,'Money refunded','FINANCE',
   '{"description":"Provider-confirmed refunds by first success date and currency, including retained financial history in Global totals and grocery refunds at locations. Pending, failed and requested refunds do not count. Retained records missing confirmation dates make the affected report unavailable."}',
   '2026-09-10.commerce-reports','payment_refund.succeeded_at','EXPLICIT_IANA_REQUEST_TIMEZONE',
   '{"global":"all retained financial purposes","location":"GROCERY_CHECKOUT and ORDER_AMENDMENT","refundStatus":"SUCCEEDED"}','{"unknown_dates_or_scope":"unavailable"}','MINOR_UNITS_BY_CURRENCY','APPROVED',1788998400000,'["marketId","locationId","currency"]',NULL);

-- Retire extra historical reports from the active reading path without deleting
-- their definitions or commercial records. Explicit history remains readable.
UPDATE metric_definitions SET status='SUPERSEDED',
  unavailable_reason='Retired from the approved commerce reports; historical definition retained.'
WHERE status='APPROVED' AND code NOT IN
  ('order_count','new_customers','active_customers','repeat_customers','repeat_orders','received_amount','refund_amount');

INSERT INTO metric_definitions
  (id,code,version,display_name,category,formula_json,source_contract_version,
   event_time_field,reporting_timezone_policy,inclusion_json,exclusion_json,
   rounding_policy,status,approved_at,dimensions_json,unavailable_reason)
VALUES
  ('metric-delivered_orders-v1','delivered_orders',1,'Delivered Orders','ORDERS','{"description":"Orders delivered in the selected period by delivery completion date."}','2026-09-10.commerce-reports','delivery_job.delivered_at','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-canceled_orders-v1','canceled_orders',1,'Canceled Orders','ORDERS','{"description":"Orders whose cancellation completed in the selected period; pending refunds or cancellation requests are separate from completion."}','2026-09-10.commerce-reports','order_cancellation completion or unpaid cancellation audit','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId"]',NULL),
  ('metric-paid_product_quantity-v1','paid_product_quantity',1,'Paid Product quantity','INVENTORY','{"description":"Selling units purchased in the selected period for one selected Product option. Original lines count at Order commitment; paid additions count once at their own commitment."}','2026-09-10.commerce-reports','original or amendment commitment','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','SELLING_UNITS','APPROVED',1788998400000,'["marketId","locationId","skuId"]',NULL),
  ('metric-canceled_product_quantity-v1','canceled_product_quantity',1,'Canceled Product quantity','INVENTORY','{"description":"Paid selling units on Orders whose cancellation completed in the selected period, including committed additions. Shown separately from paid quantities."}','2026-09-10.commerce-reports','Order cancellation completion','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','SELLING_UNITS','APPROVED',1788998400000,'["marketId","locationId","skuId"]',NULL),
  ('metric-delivery_charges-v1','delivery_charges',1,'Accepted delivery charges','DELIVERY','{"description":"Accepted delivery charges, including committed additions, for Orders first paid in the selected period. Compare with recorded delivery costs for the same Orders; this is not profit."}','2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','MINOR_UNITS_BY_CURRENCY','APPROVED',1788998400000,'["marketId","locationId","currency"]',NULL),
  ('metric-delivery_costs-v1','delivery_costs',1,'Recorded delivery costs','DELIVERY','{"description":"Recorded courier or manual costs for the same Orders first paid in the selected period. Any unknown cost or incompatible currency makes this figure unavailable."}','2026-09-10.commerce-reports','order_payment_reaction.applied_at','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','MINOR_UNITS_BY_CURRENCY','APPROVED',1788998400000,'["marketId","locationId","currency"]',NULL),
  ('metric-promotion_redemptions-v2','promotion_redemptions',2,'Committed promotion uses','PROMOTIONS','{"description":"Distinct promotion redemptions committed to paid Orders or paid additions during the selected period. Later cancellations or refunds do not erase usage history."}','2026-09-10.commerce-reports','order_promotion_application.created_at','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','INTEGER_COUNT','APPROVED',1788998400000,'["marketId","locationId","promotionId","promotionBenefitType"]',NULL),
  ('metric-discount_spend-v2','discount_spend',2,'Committed discounts','PROMOTIONS','{"description":"Discount amounts from immutable paid Order and paid addition allocations committed in the selected period, in the selected currency. This is not profit."}','2026-09-10.commerce-reports','order_promotion_application.created_at','EXPLICIT_IANA_REQUEST_TIMEZONE','{"source":"committed commerce facts"}','{"unknown_required_evidence":"unavailable"}','MINOR_UNITS_BY_CURRENCY','APPROVED',1788998400000,'["marketId","locationId","currency","promotionId","promotionBenefitType"]',NULL);

CREATE TRIGGER metric_definitions_no_update
BEFORE UPDATE ON metric_definitions
BEGIN
  SELECT RAISE(ABORT, 'metric definitions are immutable');
END;
