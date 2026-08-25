import type { AppError, RpcResult } from "./common";
import type { AuthService } from "./auth";
import type { CatalogService } from "./catalog";
import type { CheckoutService } from "./checkout";
import type {
  AdminOrderCommandRequest,
  CommittedOrderView,
  CommitMockOrderRequest,
  HealthService,
  StartTrialRequest,
  SubscriptionEligibility,
} from "./index";
import type { MembershipService } from "./membership";
import type { CancellationResult, OrdersService, RequestOrderCancellationRequest } from "./orders";
import type { OperationsService } from "./operations";
import type { OperationsCommandState } from "./states";

/**
 * The subset of the Core binding that Core supplies today. Target services are
 * adopted member-by-member as downstream remediation plans implement them.
 */
export interface ImplementedCoreService
  extends
    HealthService,
    Pick<AuthService, "auth" | "getApplicationContext">,
    CatalogService,
    Pick<MembershipService, "getSubscriptionEligibility">,
    CheckoutService,
    Pick<OrdersService, "listCustomerOrders"> {}

/** Sandbox-only and pre-Promotions compatibility methods. Replaced by Plans 06 and 07. */
export interface LegacyCommerceService {
  /** Sandbox commitment path guarded by PAYMENT_MODE; replaced by canonical checkout commitment (Plan 07). */
  commitMockOrder(request: CommitMockOrderRequest): Promise<RpcResult<CommittedOrderView>>;
  /** Compatibility trial entry; replaced by Promotions-owned startTrial (Plan 06). */
  startTrial(request: StartTrialRequest): Promise<RpcResult<SubscriptionEligibility>>;
}

/** Generic operations commands pending the Plan 08 canonical operations surface. */
export interface LegacyOperationsService extends OperationsService {
  /** Legacy paid-order cancel/refund; replaced by requestCancellation plus Payments refunds (Plans 05/07). */
  advanceOrder(
    request: AdminOrderCommandRequest,
  ): Promise<
    | { ok: true; value: { id: string; status: OperationsCommandState }; requestId: string }
    | { ok: false; error: AppError }
  >;
}

/**
 * The full Worker binding surface. Legacy members are compile-time
 * distinguishable so callers migrate deliberately before their removal gates.
 */
export interface CoreServiceBinding
  extends
    ImplementedCoreService,
    LegacyCommerceService,
    LegacyOperationsService,
    Pick<OrdersService, "requestCancellation"> {}

export type { CancellationResult, RequestOrderCancellationRequest };

export type { AuthService } from "./auth";
export type { CatalogService } from "./catalog";
export type { CheckoutService } from "./checkout";
export type { MembershipService, SubscriptionSummary } from "./membership";
export type { PaymentsService, PaymentActionView, PaymentSummary } from "./payments";
export type { OrdersService } from "./orders";
export type { OperationsService } from "./operations";
