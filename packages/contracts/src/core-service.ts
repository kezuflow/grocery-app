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
 * The Core binding surface Core supplies today. The five operations commands
 * are canonical typed domain commands (Plan 08); the read models are
 * purpose-built decision DTOs.
 */
export interface ImplementedCoreService
  extends
    HealthService,
    Pick<AuthService, "auth" | "getApplicationContext">,
    CatalogService,
    Pick<MembershipService, "getSubscriptionEligibility" | "startTrial">,
    CheckoutService,
    Pick<OrdersService, "listCustomerOrders">,
    OperationsReadService,
    OperationsService {}

/**
 * The full Worker binding surface. Every member is a canonical typed domain
 * command or purpose-built read model; generic table access has no place
 * here.
 */
export interface CoreServiceBinding
  extends ImplementedCoreService, Pick<OrdersService, "requestCancellation"> {
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
