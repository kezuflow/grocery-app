/** Named Core query functions are selected only through this closed registry. */
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

/**
 * Persisted D1 rows own all definition metadata. This registry intentionally
 * contains only the allowed code-to-named-function binding; null marks a
 * required blocked metric that must never be calculated.
 */
export const metricQueryKeyByCode = {
  order_count: "orderCount",
  refund_amount: "refundAmount",
  new_customers: "newCustomers",
  active_customers: "activeCustomers",
  repeat_customer_rate: "repeatCustomerRate",
  orders_per_customer: "ordersPerCustomer",
  active_members: "activeMembers",
  trialing_members: "trialingMembers",
  promotion_redemptions: "promotionRedemptions",
  discount_spend: "discountSpend",
  promotion_influenced_order_revenue: "promotionInfluencedOrderRevenue",
  fulfillment_time: "fulfillmentTime",
  picking_time: "pickingTime",
  packing_time: "packingTime",
  delivery_time: "deliveryTime",
  late_delivery_rate: "lateDeliveryRate",
  cancellation_rate: "cancellationRate",
  out_of_stock_rate: "outOfStockRate",
  stockouts: "stockouts",
  inventory_adjustments_shrinkage: "inventoryAdjustmentsShrinkage",
  gmv: null,
  revenue_net_sales: null,
  average_order_value: null,
  refund_rate: null,
  trial_to_paid_conversion: null,
  monthly_recurring_revenue: null,
  churn: null,
  promotion_redemption_rate: null,
  substitution_rate: null,
  inventory_turnover: null,
} as const satisfies Readonly<Record<string, AnalyticsQueryKey | null>>;

export type MetricCode = keyof typeof metricQueryKeyByCode;

export function isMetricCode(value: string): value is MetricCode {
  return Object.hasOwn(metricQueryKeyByCode, value);
}
