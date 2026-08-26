import type { RpcResult } from "./common";
import type { AuthService } from "./auth";
import type { CatalogService } from "./catalog";
import type { CheckoutService } from "./checkout";
import type { AdminOrderCommandRequest, HealthService } from "./index";
import type { MembershipService } from "./membership";
import type { CancellationResult, OrdersService, RequestOrderCancellationRequest } from "./orders";
import type { OperationsReadService, OperationsService } from "./operations";
import type { CheckoutQuoteCommandRequest, CheckoutQuoteRefreshRequest } from "./index";
import type { CheckoutQuoteView, PaymentIntentCommandRequest, PaymentActionView } from "./index";

/**
 * The subset of the Core binding that Core supplies today. Target services are
 * adopted member-by-member as downstream remediation plans implement them.
 */
export interface ImplementedCoreService
  extends
    HealthService,
    Pick<AuthService, "auth" | "getApplicationContext">,
    CatalogService,
    Pick<MembershipService, "getSubscriptionEligibility" | "startTrial">,
    CheckoutService,
    Pick<OrdersService, "listCustomerOrders">,
    OperationsReadService {}

/** Generic operations commands pending the Plan 08 canonical operations surface. */
export interface LegacyOperationsService extends OperationsService {}

/**
 * The full Worker binding surface. Legacy members are compile-time
 * distinguishable so callers migrate deliberately before their removal gates.
 */
export interface CoreServiceBinding
  extends
    ImplementedCoreService,
    LegacyOperationsService,
    Pick<OrdersService, "requestCancellation"> {
  /** Canonical quote creation resolved against the authenticated customer. */
  createCheckoutQuote(request: CheckoutQuoteCommandRequest): Promise<RpcResult<CheckoutQuoteView>>;
  refreshCheckoutQuote(request: CheckoutQuoteRefreshRequest): Promise<RpcResult<CheckoutQuoteView>>;
  /** Canonical payment intent creation for a quote (fail-closed without a provider). */
  createPaymentIntent(request: PaymentIntentCommandRequest): Promise<RpcResult<PaymentActionView>>;
}

export type { CancellationResult, RequestOrderCancellationRequest };

export type { AuthService } from "./auth";
export type { CatalogService } from "./catalog";
export type { CheckoutService } from "./checkout";
export type { MembershipService, SubscriptionSummary } from "./membership";
export type { PaymentsService, PaymentActionView, PaymentSummary } from "./payments";
export type { OrdersService } from "./orders";
export type { OperationsReadService } from "./operations";
export type { OperationsService } from "./operations";
