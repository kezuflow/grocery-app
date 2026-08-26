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
  PENDING: ["TRIALING", "ACTIVE", "CANCELED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "CANCELED"],
  PAST_DUE: ["ACTIVE", "CANCELED"],
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
  DRAFT: ["APPROVED", "CANCELED"],
  APPROVED: ["ORDERED", "RECEIVING"],
  ORDERED: ["RECEIVING"],
  RECEIVING: ["PARTIALLY_RECEIVED", "RECEIVED", "EXCEPTION"],
  PARTIALLY_RECEIVED: ["RECEIVING", "RECEIVED", "EXCEPTION"],
};
export const fulfillmentTransitions: StateMap = {
  PENDING: ["PICKING"],
  PICKING: ["PACKED", "SHORTAGE"],
  SHORTAGE: ["PICKING", "CANCELED"],
  PACKED: ["DISPATCHED"],
};
export const deliveryTransitions: StateMap = {
  PENDING: ["DISPATCHED"],
  DISPATCHED: ["DELIVERED", "FAILED"],
  FAILED: ["DISPATCHED", "CANCELED"],
};
