import type {
  AnalyticsDimensionKey,
  AnalyticsMetricCategory,
  MetricDefinitionStatus,
  MetricDefinitionView,
} from "@freshmarkets/contracts";

export type AnalyticsQueryKey =
  | "orderCount"
  | "refundAmount"
  | "newCustomers"
  | "activeCustomers"
  | "repeatCustomerRate"
  | "ordersPerCustomer"
  | "activeMembers"
  | "trialingMembers"
  | "promotionRedemptions"
  | "discountSpend"
  | "promotionInfluencedOrderRevenue"
  | "fulfillmentTime"
  | "pickingTime"
  | "packingTime"
  | "deliveryTime"
  | "lateDeliveryRate"
  | "cancellationRate"
  | "outOfStockRate"
  | "stockouts"
  | "inventoryAdjustmentsShrinkage";

export type MetricCatalogEntry = {
  definition: MetricDefinitionView;
  status: MetricDefinitionStatus;
  queryKey: AnalyticsQueryKey | null;
};

const approvedAt = "2026-08-29T00:00:00.000Z";
const accountingDefinitionRequired =
  "Requires an approved accounting definition of gross/net components, cancellations, refunds, fees, tax, and event-time recognition.";

function available(
  code: string,
  displayName: string,
  category: AnalyticsMetricCategory,
  formulaDescription: string,
  queryKey: AnalyticsQueryKey,
  dimensions: ReadonlyArray<AnalyticsDimensionKey> = [],
): MetricCatalogEntry {
  return {
    definition: {
      code,
      version: 1,
      displayName,
      category,
      formulaDescription,
      availability: "AVAILABLE",
      unavailableReason: null,
      dimensions,
      freshness: null,
      approvedAt,
    },
    status: "APPROVED",
    queryKey,
  };
}

function blocked(
  code: string,
  displayName: string,
  category: AnalyticsMetricCategory,
  formulaDescription: string,
  unavailableReason: string,
  dimensions: ReadonlyArray<AnalyticsDimensionKey> = [],
): MetricCatalogEntry {
  return {
    definition: {
      code,
      version: 1,
      displayName,
      category,
      formulaDescription,
      availability: "UNAVAILABLE",
      unavailableReason,
      dimensions,
      freshness: null,
      approvedAt: null,
    },
    status: "BLOCKED",
    queryKey: null,
  };
}

/**
 * The only source of metric-code-to-query binding. Formula descriptions are
 * display metadata; Core selects named functions through `queryKey` and never
 * evaluates persisted JSON as code or client-supplied SQL.
 */
export const metricCatalog = [
  available(
    "order_count",
    "Order count",
    "ORDERS",
    "Count Orders by first successful commitment instant.",
    "orderCount",
    ["marketId", "locationId"],
  ),
  available(
    "refund_amount",
    "Refund amount",
    "FINANCE",
    "Sum successful Refund amounts by refund-success instant and currency.",
    "refundAmount",
    ["marketId", "locationId", "currency"],
  ),
  available(
    "new_customers",
    "New customers",
    "CUSTOMERS",
    "Count Customer aggregates created in the reporting window.",
    "newCustomers",
    ["marketId", "locationId"],
  ),
  available(
    "active_customers",
    "Active customers",
    "CUSTOMERS",
    "Count distinct Customers with a first Order commitment instant in the reporting window.",
    "activeCustomers",
    ["marketId", "locationId"],
  ),
  available(
    "repeat_customer_rate",
    "Repeat customer rate",
    "CUSTOMERS",
    "Divide active Customers with a committed Order before their first in-window commitment by active Customers; empty denominator returns null.",
    "repeatCustomerRate",
    ["marketId", "locationId"],
  ),
  available(
    "orders_per_customer",
    "Orders per customer",
    "CUSTOMERS",
    "Divide Order count by active Customers; empty denominator returns null.",
    "ordersPerCustomer",
    ["marketId", "locationId"],
  ),
  available(
    "active_members",
    "Active members",
    "MEMBERSHIPS",
    "Point-in-time count of effective ACTIVE subscriptions after timestamp eligibility rules.",
    "activeMembers",
    ["marketId", "locationId"],
  ),
  available(
    "trialing_members",
    "Trialing members",
    "MEMBERSHIPS",
    "Point-in-time count of effective TRIALING subscriptions after timestamp eligibility rules.",
    "trialingMembers",
    ["marketId", "locationId"],
  ),
  available(
    "promotion_redemptions",
    "Promotion redemptions",
    "PROMOTIONS",
    "Count Promotion redemption records by redeemedAt.",
    "promotionRedemptions",
    ["marketId", "locationId", "promotionId", "promotionBenefitType"],
  ),
  available(
    "discount_spend",
    "Discount spend",
    "PROMOTIONS",
    "Sum snapshotted applied benefit amounts by merchandise, delivery, and membership-fee component without combining currencies.",
    "discountSpend",
    ["marketId", "locationId", "currency", "promotionBenefitType"],
  ),
  available(
    "promotion_influenced_order_revenue",
    "Promotion-influenced Order revenue",
    "PROMOTIONS",
    "Sum committed Order final totals for Orders with an Order or delivery Promotion redemption; this is influence labeling, not causal attribution.",
    "promotionInfluencedOrderRevenue",
    ["marketId", "locationId", "currency", "promotionId"],
  ),
  available(
    "fulfillment_time",
    "Fulfillment time",
    "FULFILLMENT",
    "Measure fulfillmentCompletedAt minus committedAt for completed fulfillments.",
    "fulfillmentTime",
    ["marketId", "locationId"],
  ),
  available(
    "picking_time",
    "Picking time",
    "FULFILLMENT",
    "Measure pickingCompletedAt minus pickingStartedAt where both events exist.",
    "pickingTime",
    ["marketId", "locationId"],
  ),
  available(
    "packing_time",
    "Packing time",
    "FULFILLMENT",
    "Measure packedAt minus packingStartedAt where both events exist.",
    "packingTime",
    ["marketId", "locationId"],
  ),
  available(
    "delivery_time",
    "Delivery time",
    "DELIVERY",
    "Measure deliveredAt minus dispatchedAt for delivered jobs.",
    "deliveryTime",
    ["marketId", "locationId"],
  ),
  available(
    "late_delivery_rate",
    "Late-delivery rate",
    "DELIVERY",
    "Divide delivered jobs after their snapshotted promise plus unresolved jobs past it by jobs whose promise elapsed in the window.",
    "lateDeliveryRate",
    ["marketId", "locationId"],
  ),
  available(
    "cancellation_rate",
    "Cancellation rate",
    "ORDERS",
    "Divide first-committed Orders in the window that later reach CANCELED by Order count for the same commitment cohort.",
    "cancellationRate",
    ["marketId", "locationId"],
  ),
  available(
    "out_of_stock_rate",
    "Out-of-stock rate",
    "INVENTORY",
    "Divide active-SKU availability checks rejected for insufficient usable location stock by evaluated active-SKU availability checks.",
    "outOfStockRate",
    ["marketId", "locationId"],
  ),
  available(
    "stockouts",
    "Stockouts",
    "INVENTORY",
    "Count location inventory-pool transitions from usable quantity above zero to zero, deduplicated by ledger transition.",
    "stockouts",
    ["marketId", "locationId", "baseUnit"],
  ),
  available(
    "inventory_adjustments_shrinkage",
    "Inventory adjustments/shrinkage",
    "INVENTORY",
    "Sum signed base-unit adjustment ledger movements by Product base unit, location, and reason without mixing dimensions.",
    "inventoryAdjustmentsShrinkage",
    ["marketId", "locationId", "baseUnit", "inventoryAdjustmentReason"],
  ),
  blocked(
    "gmv",
    "GMV",
    "FINANCE",
    "Gross merchandise value under an approved accounting definition.",
    accountingDefinitionRequired,
    ["marketId", "locationId", "currency"],
  ),
  blocked(
    "revenue_net_sales",
    "Revenue/net sales",
    "FINANCE",
    "Net sales under an approved accounting definition.",
    accountingDefinitionRequired,
    ["marketId", "locationId", "currency"],
  ),
  blocked(
    "average_order_value",
    "AOV",
    "FINANCE",
    "Average order value under an approved accounting definition.",
    accountingDefinitionRequired,
    ["marketId", "locationId", "currency"],
  ),
  blocked(
    "refund_rate",
    "Refund rate",
    "FINANCE",
    "Refund rate under an approved accounting definition.",
    accountingDefinitionRequired,
    ["marketId", "locationId", "currency"],
  ),
  blocked(
    "trial_to_paid_conversion",
    "Trial-to-paid conversion",
    "MEMBERSHIPS",
    "Trial cohort conversion to paid membership.",
    "Requires an approved cohort and conversion-window definition.",
    ["marketId", "locationId"],
  ),
  blocked(
    "monthly_recurring_revenue",
    "MRR",
    "MEMBERSHIPS",
    "Monthly recurring revenue.",
    "Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.",
    ["marketId", "locationId", "currency"],
  ),
  blocked(
    "churn",
    "Churn",
    "MEMBERSHIPS",
    "Membership churn.",
    "Requires approved renewal, grace/dunning, fee-waiver, and effective-cancellation policy.",
    ["marketId", "locationId"],
  ),
  blocked(
    "promotion_redemption_rate",
    "Promotion redemption rate",
    "PROMOTIONS",
    "Promotion redemptions divided by an approved eligible denominator.",
    "Requires an approved promotion-redemption denominator.",
    ["marketId", "locationId", "promotionId"],
  ),
  blocked(
    "substitution_rate",
    "Substitution rate",
    "FULFILLMENT",
    "Substitutions divided by an approved denominator.",
    "Unavailable while substitutions are out of scope.",
    ["marketId", "locationId"],
  ),
  blocked(
    "inventory_turnover",
    "Inventory turnover",
    "INVENTORY",
    "Inventory turnover over an approved period basis.",
    "Deferred until its cost and period basis is approved.",
    ["marketId", "locationId", "baseUnit"],
  ),
] as const satisfies ReadonlyArray<MetricCatalogEntry>;
