import type { ManualDeliveryAction } from "@freshmarkets/contracts";
import { firstDispatchEligibility } from "./dispatch-eligibility";

/** Committed mode and recorded custody, never the current global selling mode. */
export function manualDeliveryActions(facts: {
  mode: string;
  jobStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  attempt: { method: string; status: string; handedOverAt: number | null } | null;
  pendingCancellation: boolean;
  retryReady: boolean;
  deliveryDeadline: number | null;
  now: number;
  returnedGoodsInspected?: boolean;
}): ManualDeliveryAction[] {
  const attempt = facts.attempt;
  if (!attempt || ["CANCELED", "RETURNED", "FAILED"].includes(attempt.status)) {
    if (facts.mode === "INSTANT" && attempt === null) return [];
    return firstDispatchEligibility({
      canManage: true,
      jobStatus: facts.jobStatus,
      orderStatus: facts.orderStatus,
      fulfillmentStatus: facts.fulfillmentStatus,
      pendingCancellation: facts.pendingCancellation,
      latestAttempt: attempt,
      retryReady: facts.retryReady,
      deliveryDeadline: facts.deliveryDeadline,
      now: facts.now,
    }).eligible
      ? ["ASSIGN"]
      : [];
  }
  if (attempt.method !== "MANUAL" || attempt.status !== "ACTIVE") return [];
  if (
    facts.jobStatus === "ASSIGNED" &&
    attempt.handedOverAt === null &&
    ["COMMITTED", "FULFILLMENT_PENDING", "FULFILLMENT_READY"].includes(facts.orderStatus)
  ) {
    return facts.fulfillmentStatus === "PACKED" && facts.orderStatus === "FULFILLMENT_READY"
      ? ["HAND_OVER", "FAIL"]
      : ["FAIL"];
  }
  return facts.jobStatus === "EN_ROUTE" &&
    attempt.handedOverAt !== null &&
    facts.fulfillmentStatus === "HANDED_OFF" &&
    facts.orderStatus === "OUT_FOR_DELIVERY"
    ? ["COMPLETE", "FAIL"]
    : [];
}
