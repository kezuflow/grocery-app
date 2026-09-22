export const dispatchEligibilityBlockerCodes = [
  "DELIVERY_MANAGEMENT_REQUIRED",
  "DELIVERY_JOB_UNAVAILABLE",
  "ORDER_NOT_READY_FOR_DISPATCH",
  "FULFILLMENT_NOT_PACKED",
  "DELIVERY_WINDOW_UNAVAILABLE",
  "DELIVERY_EXECUTION_UNRESOLVED",
] as const;

export type DispatchEligibilityBlockerCode = (typeof dispatchEligibilityBlockerCodes)[number];

export type DispatchEligibility = {
  eligible: boolean;
  blockers: readonly DispatchEligibilityBlockerCode[];
};

/**
 * Shared read/command meaning for starting either Manual or external dispatch.
 * Commands additionally revalidate these facts in their atomic admission SQL.
 */
export function firstDispatchEligibility(facts: {
  canManage: boolean;
  jobStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  pendingCancellation: boolean;
  latestAttempt: { status: string } | null;
  retryReady: boolean;
  deliveryDeadline: number | null;
  now: number;
}): DispatchEligibility {
  const blockers: DispatchEligibilityBlockerCode[] = [];
  if (!facts.canManage) blockers.push("DELIVERY_MANAGEMENT_REQUIRED");
  if (facts.orderStatus !== "FULFILLMENT_READY") blockers.push("ORDER_NOT_READY_FOR_DISPATCH");
  if (facts.fulfillmentStatus !== "PACKED") blockers.push("FULFILLMENT_NOT_PACKED");
  if (facts.deliveryDeadline === null || facts.deliveryDeadline <= facts.now)
    blockers.push("DELIVERY_WINDOW_UNAVAILABLE");
  if (facts.pendingCancellation) blockers.push("DELIVERY_EXECUTION_UNRESOLVED");

  if (facts.latestAttempt === null) {
    if (!["UNASSIGNED", "RETRY_SCHEDULED"].includes(facts.jobStatus))
      blockers.push("DELIVERY_JOB_UNAVAILABLE");
  } else if (!facts.retryReady) {
    blockers.push("DELIVERY_EXECUTION_UNRESOLVED");
  }

  return { eligible: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function dispatchUnavailableMessage(eligibility: DispatchEligibility): string {
  const blocker = eligibility.blockers[0];
  switch (blocker) {
    case "DELIVERY_MANAGEMENT_REQUIRED":
      return "Delivery management access is required.";
    case "ORDER_NOT_READY_FOR_DISPATCH":
    case "FULFILLMENT_NOT_PACKED":
      return "Finish packing the paid order before choosing a delivery method.";
    case "DELIVERY_WINDOW_UNAVAILABLE":
      return "The committed delivery promise is unavailable or has passed.";
    case "DELIVERY_EXECUTION_UNRESOLVED":
      return "Resolve the current or uncertain delivery attempt before starting another.";
    default:
      return "This delivery job is not available for dispatch.";
  }
}
