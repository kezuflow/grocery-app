import type { RpcResult } from "./common";
import type { AdminFoundationService } from "./admin-foundation";
import type { AdminStaffAccessService } from "./admin-staff-access";
import type { AdminCustomerService, AdminPrivacyService } from "./admin-customers";
import type { AdminPromotionsService } from "./admin-promotions";
import type { AuthService } from "./auth";
import type { CatalogService } from "./catalog";
import type { CheckoutService } from "./checkout";
import type { HealthService } from "./index";
import type { MembershipService } from "./membership";
import type { OrdersService } from "./orders";
import type { OperationsReadService, OperationsService } from "./operations";
import type { PaymentsService } from "./payments";
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
    Pick<PaymentsService, "beginRecurringAuthorization" | "completeRecurringAuthorization">,
    CheckoutService,
    Pick<OrdersService, "listCustomerOrders">,
    OperationsReadService,
    OperationsService,
    AdminFoundationService,
    AdminStaffAccessService,
    AdminCustomerService,
    AdminPrivacyService,
    AdminPromotionsService {}

/**
 * The full Worker binding surface. Every member is a canonical typed domain
 * command or purpose-built read model; generic table access has no place
 * here.
 */
export interface CoreServiceBinding extends ImplementedCoreService {
  /** Canonical quote creation resolved against the authenticated customer. */
  createCheckoutQuote(request: CheckoutQuoteCommandRequest): Promise<RpcResult<CheckoutQuoteView>>;
  refreshCheckoutQuote(request: CheckoutQuoteRefreshRequest): Promise<RpcResult<CheckoutQuoteView>>;
  /** Canonical payment intent creation for a quote (fail-closed without a provider). */
  createPaymentIntent(request: PaymentIntentCommandRequest): Promise<RpcResult<PaymentActionView>>;
}

export type { AdminFoundationService } from "./admin-foundation";
export type { AdminStaffAccessService } from "./admin-staff-access";
export type { AdminCustomerService, AdminPrivacyService } from "./admin-customers";
export type { AdminPromotionsService } from "./admin-promotions";
export type { AuthService } from "./auth";
export type { CatalogService } from "./catalog";
export type { CheckoutService } from "./checkout";
export type { MembershipService, SubscriptionSummary } from "./membership";
export type { PaymentsService, PaymentActionView, PaymentSummary } from "./payments";
export type { OrdersService } from "./orders";
export type { OperationsReadService } from "./operations";
export type { OperationsService } from "./operations";
