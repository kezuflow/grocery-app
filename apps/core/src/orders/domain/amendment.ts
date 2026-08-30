export const PAID_ORDER_STATUSES = ["COMMITTED", "IN_FULFILLMENT"] as const;

export type PaidOrderStatus = (typeof PAID_ORDER_STATUSES)[number];

export type AmendmentEligibility =
  | { eligible: true }
  | { eligible: false; reason: "ORDER_NOT_PAID" | "ORDER_FINAL" };

/**
 * Additive-amendment eligibility: only paid orders whose lifecycle has not
 * reached a final delivery/terminal state may gain line additions.
 */
export function amendmentEligibility(orderStatus: string): AmendmentEligibility {
  if ((PAID_ORDER_STATUSES as readonly string[]).includes(orderStatus)) return { eligible: true };
  if (["DELIVERED", "CANCELED", "REFUNDED", "EXPIRED"].includes(orderStatus))
    return { eligible: false, reason: "ORDER_FINAL" };
  return { eligible: false, reason: "ORDER_NOT_PAID" };
}
