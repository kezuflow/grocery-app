export type StateMap = Readonly<Record<string, ReadonlyArray<string>>>;

export function transition(current: string, next: string, legal: StateMap): string {
  if (!legal[current]?.includes(next)) throw new Error(`ILLEGAL_TRANSITION:${current}:${next}`);
  return next;
}

/** Application-envelope mapping of a guarded transition attempt. */
export function transitionToResult(
  current: string,
  next: string,
  legal: StateMap,
  requestId: string,
):
  | { ok: true; value: string }
  | { ok: false; error: { code: "ILLEGAL_TRANSITION"; message: string; requestId: string } } {
  try {
    return { ok: true as const, value: transition(current, next, legal) };
  } catch {
    return {
      ok: false as const,
      error: {
        code: "ILLEGAL_TRANSITION" as const,
        message: `Cannot move ${current} to ${next}`,
        requestId,
      },
    };
  }
}

export const subscriptionTransitions: StateMap = {
  PENDING: ["TRIALING", "ACTIVE", "CANCELED", "EXPIRED"],
  TRIALING: ["CANCELED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "UNPAID", "CANCELED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "UNPAID", "CANCELED", "EXPIRED"],
  UNPAID: ["ACTIVE", "CANCELED", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELED", "EXPIRED"],
  CANCELED: [],
  EXPIRED: [],
};
export const orderTransitions: StateMap = {
  COMMITTED: ["CANCELED", "REFUNDED", "IN_FULFILLMENT"],
  IN_FULFILLMENT: ["PACKED", "CANCELED"],
  PACKED: ["DISPATCHED"],
  DISPATCHED: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERY_FAILED: ["DISPATCHED", "REFUNDED"],
};
export const paymentTransitions: StateMap = {
  PENDING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["REFUNDED", "PARTIALLY_REFUNDED"],
};
export const procurementTransitions: StateMap = {
  OPEN: ["AGGREGATED"],
  AGGREGATED: ["REQUIREMENT_APPROVED", "EXCEPTION"],
  REQUIREMENT_APPROVED: ["ORDERED", "EXCEPTION"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "EXCEPTION"],
  PARTIALLY_RECEIVED: ["RECEIVED", "EXCEPTION"],
  RECEIVED: ["CLOSED"],
  EXCEPTION: ["REQUIREMENT_APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "CLOSED"],
};
export const fulfillmentTransitions: StateMap = {
  NOT_STARTED: ["PICKING"],
  PICKING: ["READY_TO_PACK", "SHORTED"],
  READY_TO_PACK: ["PACKING", "SHORTED"],
  PACKING: ["PACKED", "SHORTED"],
  PACKED: ["HANDED_OFF"],
  HANDED_OFF: ["COMPLETED"],
  SHORTED: ["PICKING", "READY_TO_PACK", "CANCELED", "ESCALATED"],
};
export const deliveryJobTransitions: StateMap = {
  UNASSIGNED: ["ASSIGNED"],
  ASSIGNED: ["EN_ROUTE"],
  EN_ROUTE: ["ARRIVED"],
  ARRIVED: ["DELIVERED", "FAILED"],
  FAILED: ["RETRY_SCHEDULED", "ESCALATED", "CANCELED"],
  RETRY_SCHEDULED: ["ASSIGNED"],
};
export const deliveryTransitions = deliveryJobTransitions;
