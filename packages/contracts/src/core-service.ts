import type { RpcResult } from "./common";
import type { AddressSearchCandidate, AddressSearchRequest } from "./geography";
import type { AdminFoundationService } from "./admin-foundation";
import type { AdminStaffAccessService } from "./admin-staff-access";
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
import type { AuthenticatedRequest, AuthService } from "./auth";
import type { CatalogService } from "./catalog";
import type {
  CheckoutQuoteCommandRequest,
  CheckoutQuoteRefreshRequest,
  CheckoutQuoteView,
  CheckoutService,
} from "./checkout";
import type { HealthService } from "./common";
import type { MembershipService } from "./membership";
import type { OrdersService } from "./orders";
import type { OperationsReadService, OperationsService } from "./operations";
import type { PaymentActionView, PaymentIntentCommandRequest, PaymentsService } from "./payments";
import type {
  BatchRoutePreview,
  CreateAndAssignDeliveryBatchRequest,
  DeliveryBatchView,
  DeliveryMapDetail,
  DeliveryMapDetailRequest,
  DeliveryMapRequest,
  DeliveryMapView,
  EligibleRiderPage,
  EligibleRidersRequest,
  PreviewDeliveryBatchRouteRequest,
  RiderBatchList,
} from "./delivery-maps";

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
    AdminPromotionsService,
    AdminCatalogService,
    AdminInventoryReadService,
    AdminOrdersService,
    AdminPaymentsService,
    AdminMembershipsService,
    AdminOrderIssuesService,
    AdminOperationsService,
    AdminAnalyticsService {}

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
  /** Canonical quote creation resolved against the authenticated customer. */
  createCheckoutQuote(request: CheckoutQuoteCommandRequest): Promise<RpcResult<CheckoutQuoteView>>;
  refreshCheckoutQuote(request: CheckoutQuoteRefreshRequest): Promise<RpcResult<CheckoutQuoteView>>;
  /** Canonical payment intent creation for a quote (fail-closed without a provider). */
  createPaymentIntent(request: PaymentIntentCommandRequest): Promise<RpcResult<PaymentActionView>>;
  /** Scoped open-delivery projection with Core-derived selectability. */
  getDeliveryMap(request: DeliveryMapRequest): Promise<RpcResult<DeliveryMapView>>;
  /** Protected delivery detail; raw snapshots never cross the binding. */
  getDeliveryMapDetail(request: DeliveryMapDetailRequest): Promise<RpcResult<DeliveryMapDetail>>;
  /** Canonical active rider candidates and current open workload. */
  getEligibleRiders(request: EligibleRidersRequest): Promise<RpcResult<EligibleRiderPage>>;
  /** Non-authoritative preview of the submitted manual delivery order. */
  previewDeliveryBatchRoute(
    request: PreviewDeliveryBatchRouteRequest,
  ): Promise<RpcResult<BatchRoutePreview>>;
  /** Atomically creates one batch, its ordered stops, and the rider assignment. */
  createAndAssignDeliveryBatch(
    request: CreateAndAssignDeliveryBatchRequest,
  ): Promise<RpcResult<DeliveryBatchView>>;
  /** Assigned operational batches for the authenticated active canonical Rider. */
  getRiderBatches(request: AuthenticatedRequest): Promise<RpcResult<RiderBatchList>>;
}

/** Runtime manifest paired with the structural interface for deployment conformance tests. */
export const coreServiceMethodNames = [
  "health",
  "auth",
  "getApplicationContext",
  "getAdminContext",
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
  "listCustomerInvitations",
  "inviteCustomer",
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
  "createAdminSku",
  "updateAdminSku",
  "setAdminSkuAvailability",
  "setAdminSkuPrice",
  "listAdminInventory",
  "getAdminInventoryLedger",
  "getFulfillmentMode",
  "activateFulfillmentMode",
  "aggregateAdminProcurementDemand",
  "startAdminReceiving",
  "recordAdminReceivedLine",
  "completeAdminReceiving",
  "advanceAdminFulfillment",
  "advanceAdminDelivery",
  "resolveAdminOperationalException",
  "listProcurementRequirements",
  "listReceivingSessions",
  "listFulfillmentQueue",
  "listDeliveryOperations",
  "getDeliveryMap",
  "getDeliveryMapDetail",
  "getEligibleRiders",
  "previewDeliveryBatchRoute",
  "createAndAssignDeliveryBatch",
  "listOperationalExceptions",
  "listAdminOrders",
  "getAdminOrder",
  "cancelAdminOrder",
  "listAdminPayments",
  "getAdminPaymentOverview",
  "getAdminPayment",
  "requestAdminRefund",
  "listAdminReconciliationCases",
  "resolveAdminReconciliationCase",
  "listAdminMemberships",
  "getAdminMembership",
  "pauseAdminMembership",
  "resumeAdminMembership",
  "cancelAdminMembership",
  "listAdminOrderIssues",
  "getAdminOrderIssue",
  "applyAdminOrderIssueAction",
  "resolveServiceability",
  "searchAddressCandidates",
  "searchCatalog",
  "getMarketplaceHome",
  "getCatalogProduct",
  "listCategories",
  "createCustomerAddress",
  "listCustomerAddresses",
  "updateCustomerAddress",
  "startTrial",
  "beginRecurringAuthorization",
  "completeRecurringAuthorization",
  "getSubscriptionEligibility",
  "listDeliveryCycles",
  "getCart",
  "setCartItem",
  "evaluateCheckout",
  "createCheckoutQuote",
  "refreshCheckoutQuote",
  "createPaymentIntent",
  "listCustomerOrders",
  "adjustInventory",
  "createProcurementRequirement",
  "receiveProcurement",
  "advanceFulfillment",
  "advanceDelivery",
  "adminOperationsBoard",
  "assignRider",
  "riderJobs",
  "getRiderBatches",
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
export type { CheckoutService } from "./checkout";
export type { MembershipService, SubscriptionSummary } from "./membership";
export type { PaymentsService, PaymentActionView, PaymentSummary } from "./payments";
export type { OrdersService } from "./orders";
export type { OperationsReadService } from "./operations";
export type { OperationsService } from "./operations";
