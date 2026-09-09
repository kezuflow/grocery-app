import type { ManualDeliveryAction } from "@freshmarkets/contracts";

/** Committed mode and recorded custody, never the current global selling mode. */
export function manualDeliveryActions(facts: {
  mode: string;
  jobStatus: string;
  orderStatus: string;
  fulfillmentStatus: string;
  attempt: { method: string; status: string; handedOverAt: number | null } | null;
  pendingCancellation: boolean;
  returnedGoodsInspected?: boolean;
}): ManualDeliveryAction[] {
  if (facts.mode !== "SCHEDULED" || facts.pendingCancellation) return [];
  const attempt = facts.attempt;
  if (!attempt || ["CANCELED", "RETURNED", "FAILED"].includes(attempt.status)) {
    const closedWithAvailableGoods =
      attempt !== null &&
      ((["CANCELED", "FAILED"].includes(attempt.status) && attempt.handedOverAt === null) ||
        facts.returnedGoodsInspected === true);
    return (!attempt || closedWithAvailableGoods) &&
      (["UNASSIGNED", "RETRY_SCHEDULED"].includes(facts.jobStatus) ||
        (facts.jobStatus === "FAILED" && closedWithAvailableGoods)) &&
      ["COMMITTED", "FULFILLMENT_PENDING", "FULFILLMENT_READY"].includes(facts.orderStatus) &&
      ["NOT_STARTED", "PICKING", "READY_TO_PACK", "PACKING", "PACKED"].includes(
        facts.fulfillmentStatus,
      )
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
