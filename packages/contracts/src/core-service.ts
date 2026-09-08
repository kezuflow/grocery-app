import type { RpcResult } from "./common";
import type { CustomerProfileService } from "./customer-profile";
import type {
  AddressReverseRequest,
  AddressSearchCandidate,
  AddressSearchRequest,
} from "./geography";
import type { AdminFoundationService } from "./admin-foundation";
import type { AdminLocationsService } from "./admin-locations";
import type { AdminServiceabilityService } from "./admin-serviceability";
import type { AdminStaffAccessService } from "./admin-staff-access";
import type { InitialAdministratorService } from "./initial-administrator";
import type { AdminCustomerService, AdminPrivacyService } from "./admin-customers";
import type { AdminPromotionsService } from "./admin-promotions";
import type { AdminCatalogService, AdminInventoryReadService } from "./admin-catalog";
import type {
  AdminOrdersService,
  AdminPaymentsService,
  AdminMembershipsService,
  AdminOrderIssuesService,
} from "./admin-finance";
import type { AdminOperationsService } from "./admin-operations";
import type { AdminAnalyticsService } from "./admin-analytics";
import type { AdminOverviewService } from "./admin-overview";
import type { AuthService } from "./auth";
import type { CatalogService } from "./catalog";
import type { CommerceConfigurationService } from "./commerce-configuration";
import type {
  AbandonCheckoutAttemptRequest,
  AbandonCheckoutResult,
  CheckoutQuoteCommandRequest,
  CheckoutQuoteRefreshRequest,
  CheckoutQuoteView,
  CheckoutService,
  FulfillmentOptionsRequest,
  FulfillmentOptionView,
} from "./checkout";
import type { HealthService, ReadinessService } from "./common";
import type { MembershipService } from "./membership";
import type { OrdersService } from "./orders";
import type { OperationsReadService, OperationsService } from "./operations";
import type {
  AmendmentPaymentIntentRequest,
  PaymentActionView,
  PaymentIntentCommandRequest,
  PaymentsService,
} from "./payments";

/**
 * The Core binding surface Core supplies today. The five operations commands
 * are canonical typed domain commands (Plan 08); the read models are
 * purpose-built decision DTOs.
 */
export interface ImplementedCoreService
  extends
    HealthService,
    ReadinessService,
    Pick<AuthService, "auth" | "getApplicationContext">,
    CatalogService,
    MembershipService,
    Pick<PaymentsService, "beginRecurringAuthorization" | "completeRecurringAuthorization">,
    CheckoutService,
    OrdersService,
    OperationsReadService,
    OperationsService,
    AdminFoundationService,
    AdminLocationsService,
    AdminServiceabilityService,
    AdminStaffAccessService,
    InitialAdministratorService,
    AdminCustomerService,
    CustomerProfileService,
    AdminPrivacyService,
    AdminPromotionsService,
    AdminCatalogService,
    AdminInventoryReadService,
    AdminOrdersService,
    AdminPaymentsService,
    AdminMembershipsService,
    AdminOrderIssuesService,
    AdminOperationsService,
    AdminAnalyticsService,
    AdminOverviewService,
    CommerceConfigurationService {}

/**
 * The full Worker binding surface. Every member is a canonical typed domain
 * command or purpose-built read model; generic table access has no place
 * here.
 */
export interface CoreServiceBinding extends ImplementedCoreService {
  /** Temporary provider-neutral candidates for the active address-editing session. */
  searchAddressCandidates(
    request: AddressSearchRequest,
  ): Promise<RpcResult<ReadonlyArray<AddressSearchCandidate>>>;
  /** Temporary reverse-geocoded address details for a pin in the active editor session. */
  reverseAddressCandidate(
    request: AddressReverseRequest,
  ): Promise<RpcResult<AddressSearchCandidate>>;
  /** Canonical quote creation resolved against the authenticated customer. */
  createCheckoutQuote(request: CheckoutQuoteCommandRequest): Promise<RpcResult<CheckoutQuoteView>>;
  listFulfillmentOptions(
    request: FulfillmentOptionsRequest,
  ): Promise<RpcResult<readonly FulfillmentOptionView[]>>;
  refreshCheckoutQuote(request: CheckoutQuoteRefreshRequest): Promise<RpcResult<CheckoutQuoteView>>;
  abandonCheckoutAttempt(
    request: AbandonCheckoutAttemptRequest,
  ): Promise<RpcResult<AbandonCheckoutResult>>;
  /** Canonical payment intent creation for a quote (fail-closed without a provider). */
  createPaymentIntent(request: PaymentIntentCommandRequest): Promise<RpcResult<PaymentActionView>>;
  createAmendmentPaymentIntent(
    request: AmendmentPaymentIntentRequest,
  ): Promise<RpcResult<PaymentActionView>>;
}

/** Runtime manifest paired with the structural interface for deployment conformance tests. */
export const coreServiceMethodNames = [
  "health",
  "readiness",
  "auth",
  "getApplicationContext",
  "getAdminContext",
  "getAdminBootstrap",
  "getAdminOverview",
  "getMembershipPriceConfiguration",
  "updateMembershipPriceConfiguration",
  "listAdminScopes",
  "listMetricDefinitions",
  "getOverview",
  "getAnalyticsOverview",
  "getMetric",
  "getMetricSeries",
  "listAdminAuditEvents",
  "getAdminAuditEvent",
  "listAdminStaff",
  "getAdminStaff",
  "listAdminStaffInvitations",
  "inviteAdminStaff",
  "getMyStaffInvitation",
  "getInitialAdministratorSetup",
  "completeInitialAdministratorSetup",
  "acceptStaffInvitation",
  "revokeAdminStaffInvitation",
  "updateAdminStaff",
  "changeAdminStaffAccess",
  "setAdminStaffRoles",
  "setAdminStaffScopes",
  "revokeAdminStaffSessions",
  "listAdminRoles",
  "getAdminRole",
  "createAdminRole",
  "updateAdminRole",
  "setAdminRoleCapabilities",
  "archiveAdminRole",
  "listCapabilityDefinitions",
  "listAdminCustomers",
  "getAdminCustomer",
  "getMyCustomerProfile",
  "updateMyCustomerProfile",
  "listCustomerInvitations",
  "inviteCustomer",
  "getMyCustomerInvitation",
  "acceptCustomerInvitation",
  "revokeCustomerInvitation",
  "changeCustomerAccess",
  "revokeCustomerSessions",
  "requestCustomerClosure",
  "listPrivacyRequests",
  "applyPrivacyAction",
  "listAdminPromotions",
  "getAdminPromotion",
  "createAdminPromotion",
  "updateAdminPromotion",
  "changeAdminPromotionStatus",
  "previewAdminPromotion",
  "grantAdminPromotion",
  "listPromotionGrants",
  "listPromotionRedemptions",
  "listAdminCategories",
  "createAdminCategory",
  "getAdminCategory",
  "updateAdminCategory",
  "setAdminCategoryStatus",
  "listAdminUnits",
  "createAdminUnit",
  "listAdminProducts",
  "createAdminProduct",
  "getAdminProduct",
  "updateAdminProduct",
  "setAdminProductStatus",
  "uploadAdminProductMedia",
  "updateAdminProductMedia",
  "removeAdminProductMedia",
  "getAdminProductMediaContent",
  "createAdminSku",
  "updateAdminSku",
  "setAdminSkuAvailability",
  "setAdminSkuPrice",
  "getAdminSkuPrices",
  "listAdminLocations",
  "createAdminLocation",
  "updateAdminLocation",
  "transitionAdminLocation",
  "getAdminServiceability",
  "publishAdminServiceArea",
  "previewAdminServiceability",
  "listAdminInventory",
  "getAdminInventoryLedger",
  "getGlobalCommerceConfiguration",
  "pauseSelling",
  "activateGlobalMode",
  "openSelling",
  "aggregateAdminProcurementDemand",
  "startAdminReceiving",
  "recordAdminReceivedLine",
  "completeAdminReceiving",
  "advanceAdminFulfillment",
  "resolveAdminOperationalException",
  "listProcurementRequirements",
  "listReceivingSessions",
  "listFulfillmentQueue",
  "listDeliveryOperations",
  "getLocationDeliveryProfile",
  "upsertLocationDeliveryProfile",
  "requestExternalDelivery",
  "refreshExternalDelivery",
  "cancelExternalDelivery",
  "listOperationalExceptions",
  "listAdminOrders",
  "getAdminOrder",
  "cancelAdminOrder",
  "listAdminPayments",
  "getAdminPaymentOverview",
  "getAdminPayment",
  "requestAdminRefund",
  "recheckAdminRefund",
  "recheckAdminPayment",
  "retryAdminProviderEvent",
  "retryAdminPaymentReaction",
  "listAdminReconciliationCases",
  "resolveAdminReconciliationCase",
  "listAdminMemberships",
  "getAdminMembership",
  "cancelAdminMembership",
  "listAdminOrderIssues",
  "getAdminOrderIssue",
  "applyAdminOrderIssueAction",
  "resolveServiceability",
  "searchAddressCandidates",
  "reverseAddressCandidate",
  "searchCatalog",
  "getMarketplaceHome",
  "getCatalogProduct",
  "listCategories",
  "createCustomerAddress",
  "listCustomerAddresses",
  "updateCustomerAddress",
  "getMembershipExperience",
  "getSubscriptionSummary",
  "getOffer",
  "startTrial",
  "beginPaidEnrollment",
  "cancelSubscription",
  "beginRecurringAuthorization",
  "completeRecurringAuthorization",
  "getSubscriptionEligibility",
  "listDeliveryCycles",
  "getCart",
  "setCartItem",
  "evaluateCheckout",
  "createCheckoutQuote",
  "listFulfillmentOptions",
  "refreshCheckoutQuote",
  "abandonCheckoutAttempt",
  "createPaymentIntent",
  "listCustomerOrders",
  "getCustomerOrderDetail",
  "getProvisionalTransactionSummary",
  "cancelCustomerOrder",
  "reorderOrder",
  "submitCustomerOrderIssue",
  "listCustomerOrderIssues",
  "createOrderAmendment",
  "createAmendmentPaymentIntent",
  "adjustInventory",
  "createProcurementRequirement",
  "receiveProcurement",
  "advanceFulfillment",
  "adminScheduledJobRuns",
] as const satisfies ReadonlyArray<keyof CoreServiceBinding>;

type MissingRuntimeManifestMethod = Exclude<
  keyof CoreServiceBinding,
  (typeof coreServiceMethodNames)[number]
>;
type ExtraRuntimeManifestMethod = Exclude<
  (typeof coreServiceMethodNames)[number],
  keyof CoreServiceBinding
>;
const coreServiceMethodManifestIsExact: [
  MissingRuntimeManifestMethod,
  ExtraRuntimeManifestMethod,
] extends [never, never]
  ? true
  : never = true;
void coreServiceMethodManifestIsExact;

export type { AdminFoundationService } from "./admin-foundation";
export type { AdminStaffAccessService } from "./admin-staff-access";
export type { AdminCustomerService, AdminPrivacyService } from "./admin-customers";
export type { AdminPromotionsService } from "./admin-promotions";
export type { AdminCatalogService, AdminInventoryReadService } from "./admin-catalog";
export type { AdminOverviewService } from "./admin-overview";
export type {
  AdminOrdersService,
  AdminPaymentsService,
  AdminMembershipsService,
  AdminOrderIssuesService,
} from "./admin-finance";
export type { AdminOperationsService } from "./admin-operations";
export type { AdminAnalyticsService } from "./admin-analytics";
export type { AuthService } from "./auth";
export type { CatalogService } from "./catalog";
export type { CommerceConfigurationService } from "./commerce-configuration";
export type { CheckoutService } from "./checkout";
export type { MembershipService, SubscriptionSummary } from "./membership";
export type { PaymentsService, PaymentActionView, PaymentSummary } from "./payments";
export type { OrdersService } from "./orders";
export type { OperationsReadService } from "./operations";
export type { OperationsService } from "./operations";
