import type { PaymentState, RefundState } from "./states";
import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./auth";

// Provider-neutral payment vocabulary. Vendor states map into these canonical
// states behind the payment adapter; no vendor field appears in a DTO.
export type PaymentMethodToken = {
  kind: "TOKEN";
  value: string;
};

export type PaymentActionView = {
  paymentIntentId: string;
  state: Exclude<PaymentState, "PARTIALLY_REFUNDED" | "REFUNDED">;
  /** Mutually exclusive safe client actions; never a fabricated success state. */
  actionType: "NONE" | "REDIRECT" | "SDK";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: string | null;
};

export const paymentPurposesContract = [
  "MEMBERSHIP_ENROLLMENT",
  "MEMBERSHIP_RENEWAL",
  "GROCERY_CHECKOUT",
  "ORDER_AMENDMENT",
] as const;

export type PaymentPurpose = (typeof paymentPurposesContract)[number];

export type PaymentSummary = {
  paymentIntentId: string;
  purpose: PaymentPurpose;
  amountMinor: number;
  currency: string;
  state: PaymentState;
  updatedAt: string;
};

export type CreatePaymentRequest = AuthenticatedRequest & {
  subscriptionId?: string;
  checkoutAttemptId?: string;
  paymentMethod: PaymentMethodToken;
  returnUrl: string;
  idempotencyKey: string;
};

export type GetPaymentRequest = AuthenticatedRequest & {
  subscriptionId?: string;
  checkoutAttemptId?: string;
};

export type RecoverActivationRequest = AuthenticatedRequest & {
  subscriptionId: string;
  idempotencyKey: string;
};

export type BeginRecurringAuthorizationRequest = AuthenticatedRequest & {
  /** Optional assertion against Core's explicitly configured provider. */
  providerCode?: string;
  currency?: string;
  returnUrl: string;
  idempotencyKey: string;
};

export type RecurringAuthorizationActionView = {
  authorizationId: string;
  actionType: "REDIRECT" | "SDK" | "NONE";
  redirectUrl: string | null;
  clientToken: string | null;
  expiresAt: string | null;
};

export type CompleteRecurringAuthorizationRequest = AuthenticatedRequest & {
  authorizationId: string;
};

export type SubscriptionActivationResult = {
  subscriptionId: string;
  state: SubscriptionActivationState;
};

type SubscriptionActivationState = import("./states").SubscriptionState;

export type RefundView = {
  refundId: string;
  paymentAttemptId: string;
  amountMinor: number;
  currency: string;
  state: RefundState;
};

/**
 * Canonical payments target port. Payment success is always a canonical
 * provider-confirmed outcome; browser or initiation state never maps to
 * `SUCCEEDED` here.
 */
export type PaymentsService = {
  beginRecurringAuthorization(
    request: BeginRecurringAuthorizationRequest,
  ): Promise<RpcResult<RecurringAuthorizationActionView>>;
  completeRecurringAuthorization(
    request: CompleteRecurringAuthorizationRequest,
  ): Promise<RpcResult<{ authorizationId: string }>>;
  createPayment(request: CreatePaymentRequest): Promise<RpcResult<PaymentActionView>>;
  getPayment(request: GetPaymentRequest): Promise<RpcResult<PaymentSummary | null>>;
  recoverMembershipActivation(
    request: RecoverActivationRequest,
  ): Promise<RpcResult<SubscriptionActivationResult>>;
};

export type PaymentIntentCommandRequest = AuthenticatedRequest & {
  checkoutAttemptId: string;
  expectedQuoteVersion: number;
  expectedPriceAcceptanceVersion: number;
  expectedCurrency: string;
  expectedMerchandiseSubtotalMinor: number;
  expectedItemDiscountMinor: number;
  expectedOrderDiscountMinor: number;
  expectedDeliverySubtotalMinor: number;
  expectedDeliveryFeeMinor: number;
  expectedDeliveryDiscountMinor: number;
  expectedServiceFeeMinor: number;
  expectedTaxMinor: number;
  expectedTotalMinor: number;
  providerCode?: string;
  returnUrl: string;
  idempotencyKey: string;
};

export type AmendmentPaymentIntentRequest = AuthenticatedRequest & {
  amendmentId: string;
  expectedAmendmentVersion: number;
  expectedCurrency: string;
  expectedTotalMinor: number;
  providerCode?: string;
  returnUrl: string;
  idempotencyKey: string;
};
