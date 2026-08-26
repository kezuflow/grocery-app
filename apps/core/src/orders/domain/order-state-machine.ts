export const orderLifecycleStates = [
  "PENDING_PAYMENT",
  "COMMITTED",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLATION_REQUESTED",
  "CANCELED",
  "EXPIRED",
  "EXCEPTION",
] as const;

export type OrderLifecycleState = (typeof orderLifecycleStates)[number];

const transitions: Readonly<Record<OrderLifecycleState, readonly OrderLifecycleState[]>> = {
  PENDING_PAYMENT: ["COMMITTED", "EXPIRED", "CANCELED"],
  COMMITTED: ["FULFILLMENT_PENDING", "CANCELLATION_REQUESTED", "EXCEPTION"],
  FULFILLMENT_PENDING: ["FULFILLMENT_READY", "CANCELLATION_REQUESTED", "EXCEPTION"],
  FULFILLMENT_READY: ["OUT_FOR_DELIVERY", "CANCELLATION_REQUESTED", "EXCEPTION"],
  OUT_FOR_DELIVERY: ["DELIVERED", "EXCEPTION"],
  DELIVERED: [],
  CANCELLATION_REQUESTED: ["CANCELED"],
  EXCEPTION: ["CANCELED", "COMMITTED"],
  EXPIRED: [],
  CANCELED: [],
};

export function canTransitionOrder(from: OrderLifecycleState, to: OrderLifecycleState): boolean {
  return transitions[from].includes(to);
}

export class IllegalOrderTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
    this.name = "IllegalOrderTransitionError";
  }
}

export function transitionOrder(
  from: OrderLifecycleState,
  to: OrderLifecycleState,
): OrderLifecycleState {
  if (!canTransitionOrder(from, to)) throw new IllegalOrderTransitionError(from, to);
  return to;
}
