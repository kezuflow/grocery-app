// Canonical, provider-neutral payment domain. Vendor states and references
// never appear here; adapters translate observations into these values.

export const paymentDomainStates = [
  "INITIATED",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

export type PaymentDomainState = (typeof paymentDomainStates)[number];

export const paymentPurposes = [
  "MEMBERSHIP_ENROLLMENT",
  "MEMBERSHIP_RENEWAL",
  "GROCERY_CHECKOUT",
  "ORDER_AMENDMENT",
] as const;

export type PaymentPurpose = (typeof paymentPurposes)[number];

const paymentTransitions: Readonly<Record<PaymentDomainState, readonly PaymentDomainState[]>> = {
  INITIATED: ["REQUIRES_ACTION", "PROCESSING", "FAILED", "EXPIRED"],
  REQUIRES_ACTION: ["PROCESSING", "FAILED", "EXPIRED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export class IllegalPaymentTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
    this.name = "IllegalPaymentTransitionError";
  }
}

export function canTransitionPayment(from: PaymentDomainState, to: PaymentDomainState): boolean {
  return paymentTransitions[from].includes(to);
}

export function transitionPayment(
  from: PaymentDomainState,
  to: PaymentDomainState,
): PaymentDomainState {
  if (!canTransitionPayment(from, to)) throw new IllegalPaymentTransitionError(from, to);
  return to;
}

/**
 * MVP commitment policy: a canonical outcome is sufficient for downstream paid
 * commitment only when it is provider-confirmed `SUCCEEDED` (captured funds).
 */
export const mvpPaymentCommitmentPolicy = {
  isSufficient(state: PaymentDomainState): boolean {
    return state === "SUCCEEDED";
  },
} as const;

export type PaymentObservationInput = {
  provider: string;
  providerEventId: string;
  providerReference: string;
  observedAt: number;
  canonicalState: PaymentDomainState;
  amountMinor: number;
  currency: string;
  payloadHash: string;
};

export function isSufficientForCommitment(state: PaymentDomainState): boolean {
  return mvpPaymentCommitmentPolicy.isSufficient(state);
}
