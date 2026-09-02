import type { PaymentDomainState } from "../domain/payment";

export type ProviderSettlementObservation = {
  grossMinor: number;
  processingCostMinor: number;
  withholdingMinor: number;
  adjustmentMinor: number;
  netMinor: number;
  currency: string;
  observedAt: number;
};

type VerifiedProviderEventBase = {
  provider: string;
  providerEventId: string;
  eventType?: string;
  providerReference: string;
  observedAt: number;
  payloadHash: string;
};

export type VerifiedFinancialProviderEvent = VerifiedProviderEventBase & {
  canonicalState: PaymentDomainState;
  amountMinor: number;
  currency: string;
  kind: "payment" | "refund";
  /** Present when kind === "refund": the provider-side refund identity. */
  refundReference: string | null;
  /** Optional immutable financial evidence supplied by a verified provider event. */
  settlement?: ProviderSettlementObservation;
};

export type ProviderSubscriptionStatus =
  | "INCOMPLETE"
  | "INCOMPLETE_CANCELED"
  | "ACTIVE"
  | "PAST_DUE"
  | "UNPAID"
  | "CANCELED";

export type VerifiedSubscriptionProviderEvent = VerifiedProviderEventBase & {
  kind: "subscription";
  providerStatus: ProviderSubscriptionStatus;
  providerCustomerReference: string;
  providerPlanReference: string;
  providerPaymentMethodReference: string | null;
  latestInvoiceReference: string | null;
  nextBillingAt: number | null;
};

export type VerifiedSubscriptionInvoiceProviderEvent = VerifiedProviderEventBase & {
  kind: "subscription_invoice";
  providerSubscriptionReference: string;
  providerPaymentReference: string | null;
  providerStatus: "DRAFT" | "OPEN" | "PAID" | "VOID";
  amountMinor: number;
  currency: string;
  dueAt: number | null;
  paidAt: number | null;
};

export type VerifiedProviderEvent =
  | VerifiedFinancialProviderEvent
  | VerifiedSubscriptionProviderEvent
  | VerifiedSubscriptionInvoiceProviderEvent;

export type ProviderEventVerificationFailure = {
  ok: false;
  reason: "INVALID_SIGNATURE" | "INVALID_TIMESTAMP" | "UNPARSEABLE_PAYLOAD" | "UNKNOWN_EVENT_TYPE";
  /** True only when authenticity passed and a later parsing/mapping check failed. */
  signatureVerified?: boolean;
};

export type ProviderEventVerificationSuccess = { ok: true; event: VerifiedProviderEvent };

export type ProviderPaymentView = {
  providerReference: string;
  canonicalState: PaymentDomainState;
  amountMinor: number;
  currency: string;
};

export type ProviderAuthorizationAction = {
  providerAuthorizationReference: string;
  actionType: "REDIRECT" | "SDK" | "NONE";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: number | null;
};

export type ProviderAuthorizationView = {
  providerAuthorizationReference: string;
  recurringCapable: boolean;
  providerMethodRef: string | null;
  status: "PENDING" | "ACTIVE" | "REVOKED";
};

export type ProviderCustomerProfile = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

export type ProviderSubscriptionView = {
  providerSubscriptionReference: string;
  providerPlanReference: string;
  providerCustomerReference: string;
  providerStatus: ProviderSubscriptionStatus;
  latestInvoiceReference: string | null;
  providerPaymentReference: string | null;
  clientToken: string | null;
  nextBillingAt: number | null;
};

/**
 * The only seam through which vendor specifics enter Core. Implementations
 * verify raw HTTP ingress before any identifier or state is trusted, so a
 * caller can never construct a trusted observation from browser JSON.
 */
export interface PaymentProvider {
  readonly code: string;

  /** Creates a provider-side payment for the intent; returns an action for the client, never canonical success. */
  createPayment(input: {
    providerCustomerId: string | null;
    amountMinor: number;
    currency: string;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<
    | {
        ok: true;
        providerReference: string;
        actionType: "NONE" | "REDIRECT" | "SDK";
        redirectUrl: string | null;
        clientToken: string | null;
        expiresAt: number | null;
      }
    | { ok: false; errorCode: string }
  >;

  verifyAndParseEvent(
    headers: Headers,
    rawBody: string,
  ): Promise<ProviderEventVerificationSuccess | ProviderEventVerificationFailure>;

  /**
   * Establishes a recurring-capable authorization session for a customer. The
   * returned action is instrument collection, never canonical payment success;
   * the mandate exists only after `getAuthorization` confirms it.
   */
  createAuthorization(input: {
    providerCustomerId: string | null;
    currency: string;
    idempotencyKey: string;
    returnUrl: string;
  }): Promise<{ ok: true; action: ProviderAuthorizationAction } | { ok: false; errorCode: string }>;

  getAuthorization(
    providerAuthorizationReference: string,
  ): Promise<
    { ok: true; authorization: ProviderAuthorizationView } | { ok: false; errorCode: string }
  >;

  getPayment(providerReference: string): Promise<ProviderPaymentView | null>;

  requestRefund(input: {
    providerReference: string;
    refundProviderIdempotencyKey: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ ok: true; providerRefundReference: string } | { ok: false; errorCode: string }>;

  /** Ensure one provider customer identity for an application customer. */
  ensureCustomer?(input: {
    profile: ProviderCustomerProfile;
    existingProviderCustomerReference: string | null;
    idempotencyKey: string;
  }): Promise<{ ok: true; providerCustomerReference: string } | { ok: false; errorCode: string }>;

  /** Ensure the immutable scheduled plan for one agreed membership price version. */
  ensureSubscriptionPlan?(input: {
    priceVersionId: string;
    name: string;
    description: string;
    amountMinor: number;
    currency: string;
    existingProviderPlanReference: string | null;
    idempotencyKey: string;
  }): Promise<{ ok: true; providerPlanReference: string } | { ok: false; errorCode: string }>;

  /** Create a provider-owned scheduled subscription and its first invoice. */
  createSubscription?(input: {
    providerCustomerReference: string;
    providerPlanReference: string;
    idempotencyKey: string;
  }): Promise<
    { ok: true; subscription: ProviderSubscriptionView } | { ok: false; errorCode: string }
  >;

  getSubscription?(
    providerSubscriptionReference: string,
  ): Promise<
    { ok: true; subscription: ProviderSubscriptionView } | { ok: false; errorCode: string }
  >;

  cancelSubscription?(input: {
    providerSubscriptionReference: string;
    reason: "too_expensive" | "missing_features" | "switched_service" | "unused" | "other";
  }): Promise<
    { ok: true; subscription: ProviderSubscriptionView } | { ok: false; errorCode: string }
  >;

  /** Non-production adapter hook that still emits a normally signed raw event. */
  createTestEvent?(input: {
    providerEventId: string;
    providerReference: string;
    outcome: "SUCCEEDED" | "FAILED" | "EXPIRED";
    amountMinor: number;
    currency: string;
    observedAt: number;
  }): Promise<{ rawBody: string; headers: Headers }>;
}
