import type { OrderLifecycleState } from "./order-state-machine";

export type CancellationActor = "CUSTOMER" | "BUSINESS" | "STAFF_EXCEPTION";
export type CancellationCause =
  | "CUSTOMER_REQUEST"
  | "STOCK_UNAVAILABLE"
  | "OPERATIONAL_FAILURE"
  | "FAILED_DELIVERY"
  | "DUPLICATE_CHARGE"
  | "DAMAGED_GOODS"
  | "OTHER";

export type CancellationDecision =
  | { allowed: true; retainedServiceFeeMinor: number; refundMinor: number }
  | {
      allowed: false;
      code: "CANCELLATION_WINDOW_CLOSED" | "ORDER_NOT_CANCELABLE" | "CUTOFF_EVIDENCE_MISSING";
    };

export type OrderCancellationPolicyInput = {
  actor: CancellationActor;
  cause: CancellationCause;
  mode: "INSTANT" | "SCHEDULED";
  orderState: OrderLifecycleState;
  serviceFeeMinor: number;
  grossPaidMinor: number;
  now: number;
  cutoffAt: number | null;
};

const businessCancelableStates = new Set<OrderLifecycleState>([
  "COMMITTED",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_READY",
  "OUT_FOR_DELIVERY",
  "EXCEPTION",
]);

function validMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function decideOrderCancellation(input: OrderCancellationPolicyInput): CancellationDecision {
  if (
    !validMoney(input.grossPaidMinor) ||
    !validMoney(input.serviceFeeMinor) ||
    input.serviceFeeMinor > input.grossPaidMinor
  )
    return { allowed: false, code: "ORDER_NOT_CANCELABLE" };

  if (input.actor === "CUSTOMER") {
    if (input.orderState !== "COMMITTED")
      return {
        allowed: false,
        code: businessCancelableStates.has(input.orderState)
          ? "CANCELLATION_WINDOW_CLOSED"
          : "ORDER_NOT_CANCELABLE",
      };
    if (input.mode === "SCHEDULED") {
      if (input.cutoffAt === null) return { allowed: false, code: "CUTOFF_EVIDENCE_MISSING" };
      if (input.now >= input.cutoffAt)
        return { allowed: false, code: "CANCELLATION_WINDOW_CLOSED" };
    }
    const retainedServiceFeeMinor = input.mode === "INSTANT" ? input.serviceFeeMinor : 0;
    return {
      allowed: true,
      retainedServiceFeeMinor,
      refundMinor: input.grossPaidMinor - retainedServiceFeeMinor,
    };
  }

  const allowed =
    businessCancelableStates.has(input.orderState) ||
    (input.actor === "STAFF_EXCEPTION" && input.orderState === "DELIVERED");
  return allowed
    ? { allowed: true, retainedServiceFeeMinor: 0, refundMinor: input.grossPaidMinor }
    : { allowed: false, code: "ORDER_NOT_CANCELABLE" };
}
