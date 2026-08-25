import type { PaymentState, RefundState } from "./states";
import type { RpcResult } from "./common";
import type { AuthenticatedRequest } from "./index";

// Provider-neutral payment vocabulary. Vendor states map into these canonical
// states behind the payment adapter; no vendor field appears in a DTO.
export type PaymentMethodToken = {
  kind: "TOKEN";
  value: string;
};

export type PaymentActionView = {
  paymentAttemptId: string;
  state: Exclude<PaymentState, "PARTIALLY_REFUNDED" | "REFUNDED">;
  actionType: "NONE" | "REDIRECT" | "SDK";
  actionUrl: string | null;
};

export type PaymentSummary = {
  paymentAttemptId: string;
  purpose: "MEMBERSHIP_RENEWAL" | "ORDER_COMMITMENT" | "ORDER_AMENDMENT";
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
  createPayment(request: CreatePaymentRequest): Promise<RpcResult<PaymentActionView>>;
  getPayment(request: GetPaymentRequest): Promise<RpcResult<PaymentSummary | null>>;
  recoverMembershipActivation(
    request: RecoverActivationRequest,
  ): Promise<RpcResult<SubscriptionActivationResult>>;
};
