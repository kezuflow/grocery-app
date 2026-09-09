/** Persisted definitions own metadata; only these approved reports execute SQL. */
export const metricQueryKeyByCode = {
  order_count: "orderCount",
  delivered_orders: "deliveredOrders",
  canceled_orders: "canceledOrders",
  paid_product_quantity: "paidProductQuantity",
  canceled_product_quantity: "canceledProductQuantity",
  delivery_charges: "deliveryCharges",
  delivery_costs: "deliveryCosts",
  refund_amount: "refundAmount",
  received_amount: "receivedAmount",
  new_customers: "newCustomers",
  active_customers: "activeCustomers",
  repeat_customers: "repeatCustomers",
  repeat_orders: "repeatOrders",
  promotion_redemptions: "promotionRedemptions",
  discount_spend: "discountSpend",
  // Retained definition names are readable history, not current report scope.
  repeat_customer_rate: null,
  orders_per_customer: null,
  active_members: null,
  trialing_members: null,
  promotion_influenced_order_revenue: null,
  fulfillment_time: null,
  picking_time: null,
  packing_time: null,
  delivery_time: null,
  late_delivery_rate: null,
  cancellation_rate: null,
  out_of_stock_rate: null,
  stockouts: null,
  inventory_adjustments_shrinkage: null,
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
} as const;

export type MetricCode = keyof typeof metricQueryKeyByCode;
export type AnalyticsQueryKey = Exclude<(typeof metricQueryKeyByCode)[MetricCode], null>;

export function isMetricCode(value: string): value is MetricCode {
  return Object.hasOwn(metricQueryKeyByCode, value);
}
