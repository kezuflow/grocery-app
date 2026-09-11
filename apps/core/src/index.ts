import {
  uploadAdminBannerMedia,
  updateAdminBannerMedia,
  removeAdminBannerMedia,
} from "./admin/application/banner-media";
import {
  getAdminBannerMedia,
  getAdminBannerMediaContent,
  getPublishedBannerMedia,
  listPublishedBanners,
} from "./admin/application/banner-media-reads";
import { listAdminBanners, saveAdminBanner } from "./admin/application/storefront-banners";
import { bookAutomaticInstantDeliveries } from "./delivery/application/book-automatic-instant-deliveries";
import { getAdminScheduledWeek } from "./admin/application/scheduled-week";
import { recordScheduledCountedReceipt } from "./procurement/application/scheduled-counted-receipts";
import { releaseScheduledSurplus } from "./procurement/application/scheduled-surplus";
import {
  uploadAdminPromotionMedia,
  updateAdminPromotionMedia,
  removeAdminPromotionMedia,
} from "./admin/application/promotion-media";
import {
  getAdminPromotionMedia,
  getAdminPromotionMediaContent,
  getPublishedPromotionMedia,
  listPublishedPromotionCampaigns,
} from "./admin/application/promotion-media-reads";
import {
  getAdminPromotionAudience as getAdminPromotionAudienceQuery,
  setAdminPromotionAudience as setAdminPromotionAudienceCommand,
} from "./admin/application/promotion-audience";
import {
  adminPromotionCreateBodySchema,
  adminPromotionUpdateBodySchema,
  adminPromotionStatusBodySchema,
  adminPromotionPreviewBodySchema,
  adminPromotionGrantBodySchema,
} from "@freshmarkets/validation";
import { acceptCustomerInvitation, getMyCustomerInvitation } from "./customer/invitations";
import { getPublishedProductMedia } from "./catalog/published-product-media";
import {
  adminCategoryCreateBodySchema,
  adminCategoryUpdateBodySchema,
  adminCategoryStatusBodySchema,
  adminProductCreateBodySchema,
  adminProductUpdateBodySchema,
  adminProductStatusBodySchema,
} from "@freshmarkets/validation";
import {
  getAdminLocationFulfillment,
  configureAdminLocationFulfillment,
} from "./admin/application/location-fulfillment-readiness";
import {
  getAdminLocationSchedule,
  saveAdminLocationSchedule,
} from "./admin/application/location-schedule-administration";
import {
  listAdminDeliveryCycles,
  listAdminCycleDestinations,
  saveAdminDeliveryCycleDraft,
  scheduleAdminDeliveryCycle,
  cancelAdminDeliveryCycle,
} from "./admin/application/delivery-cycle-administration";
import { readCustomerProfile, updateMyCustomerProfile } from "./customer/profile";
import { manageMyCustomerAddress } from "./customer/manage-address";
import {
  getAdminCustomerProfile,
  updateAdminCustomerProfile,
  listCustomerSupportNotes,
  appendCustomerSupportNote,
} from "./admin/application/customer-profile-administration";
import { revokeCustomerInvitation } from "./admin/application/customer-invitations";
import {
  getInitialAdministratorSetup,
  completeInitialAdministratorSetup,
} from "./iam/application/initial-administrator";
import {
  getAdminServiceability,
  publishAdminServiceArea,
  previewAdminServiceability,
} from "./admin/application/serviceability-administration";
import {
  listAdminLocations,
  createAdminLocation,
  updateAdminLocation,
  transitionAdminLocation,
} from "./admin/application/location-administration";
import {
  getMyStaffInvitation,
  acceptStaffInvitation,
} from "./iam/application/accept-staff-invitation";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type AppErrorCode,
  type AuthContextRequest,
  type AuthRequest,
  type AuthResponse,
  type AuthenticatedRequest,
  type CoreHealthResponse,
  type CoreReadinessResponse,
  type RequestMeta,
  adminCapabilityCodes,
  analyticsDimensionKeys,
  analyticsMetricCategories,
  metricDefinitionStatuses,
} from "@freshmarkets/contracts";
import { idempotencyKeySchema, z as validationSchema } from "@freshmarkets/validation";
import { buildProviderRegistry } from "./payments/infrastructure/providers/runtime-providers";
import { configuredInstantDeliveryPartners } from "./delivery/infrastructure/runtime-delivery-provider";
import { runScheduledJobs } from "./scheduling/run-scheduled-jobs";
import {
  consumeNotificationBatch,
  type NotificationQueueMessage,
} from "./notifications/application/notification-queue";
import { createCloudflareEmailDeliveryPort } from "./notifications/infrastructure/email-delivery-port";
import { listRecentScheduledJobRuns } from "./scheduling/list-recent-runs";
import { systemClock } from "@freshmarkets/domain-shared";
import {
  addressRequestSchema,
  addressReverseRequestSchema,
  addressSearchRequestSchema,
  addressUpdateRequestSchema,
  authenticatedRequestSchema,
  serviceabilityRequestSchema,
  validationMessage,
} from "./validation";
import { handleProviderWebhook } from "./payments/http/provider-webhook";
import { drizzle } from "drizzle-orm/d1";
import { log, observeCoreRpc, requestId } from "./observability";
import { createAuth, type AuthEnvironment } from "./auth/service";
import { resolveServiceability } from "./geography/serviceability";
import { buildGeocoderPort } from "./geography/infrastructure/runtime-geocoder";
import { confirmBrowsingLocation } from "./geography/application/confirm-browsing-location";
import type { GeocoderPort } from "./geography/ports/geocoder";
import { GeocoderError } from "./geography/infrastructure/mapbox-geocoder";
import {
  createCustomerAddress,
  listCustomerAddresses,
  updateCustomerAddress,
} from "./customer/addresses";
import {
  getAdminGlobalCommerceConfiguration,
  listAdminDeliveryOperations,
  listAdminFulfillmentQueue,
  listAdminOperationalExceptions,
  listAdminProcurementRequirements,
  listAdminReceivingSessions,
} from "./admin/application/operations-reads";
import {
  activateAdminGlobalMode,
  aggregateAdminProcurementDemand,
  confirmAdminProcurementPurchase,
  startAdminReceiving,
  recordAdminReceivedLine,
  completeAdminReceiving,
  advanceAdminFulfillment,
  resolveAdminOperationalException,
  openAdminSelling,
  pauseAdminSelling,
} from "./admin/application/operations-commands";
import {
  cancelExternalDelivery as cancelExternalDeliveryCommand,
  getLocationDeliveryProfile as getLocationDeliveryProfileQuery,
  refreshExternalDelivery as refreshExternalDeliveryCommand,
  requestExternalDelivery as requestExternalDeliveryCommand,
  upsertLocationDeliveryProfile as upsertLocationDeliveryProfileCommand,
} from "./admin/application/delivery-provider-operations";
import { getAdminContext as getAdminContextQuery } from "./admin/application/get-admin-context";
import { reviseDeliveryPromise } from "./delivery/application/revise-delivery-promise";
import { manageManualDelivery } from "./delivery/application/manage-manual-delivery";
import { getAdminBootstrap as getAdminBootstrapQuery } from "./admin/application/admin-bootstrap";
import { listAdminScopes as listAdminScopesQuery } from "./admin/application/list-admin-scopes";
import { listAdminAuditEvents as listAdminAuditEventsQuery } from "./audit/application/list-audit-events";
import { getAdminAuditEvent as getAdminAuditEventQuery } from "./audit/application/get-audit-event";
import { listAdminStaff as listAdminStaffQuery } from "./admin/application/list-admin-staff";
import { getAdminStaff as getAdminStaffQuery } from "./admin/application/get-admin-staff";
import { listAdminStaffInvitations as listAdminStaffInvitationsQuery } from "./admin/application/list-admin-staff-invitations";
import {
  inviteAdminStaff as inviteAdminStaffCommand,
  revokeAdminStaffInvitation as revokeAdminStaffInvitationCommand,
} from "./admin/application/invite-admin-staff";
import {
  updateAdminStaff as updateAdminStaffCommand,
  changeAdminStaffAccess as changeAdminStaffAccessCommand,
} from "./admin/application/update-admin-staff";
import { setAdminStaffRoles as setAdminStaffRolesCommand } from "./admin/application/set-admin-staff-roles";
import { setAdminStaffScopes as setAdminStaffScopesCommand } from "./admin/application/set-admin-staff-scopes";
import { revokeAdminStaffSessions as revokeAdminStaffSessionsCommand } from "./admin/application/revoke-admin-staff-sessions";
import { listAdminRoles as listAdminRolesQuery } from "./admin/application/list-admin-roles";
import { getAdminRole as getAdminRoleQuery } from "./admin/application/get-admin-role";
import { createAdminRole as createAdminRoleCommand } from "./admin/application/create-admin-role";
import {
  updateAdminRole as updateAdminRoleCommand,
  setAdminRoleCapabilities as setAdminRoleCapabilitiesCommand,
} from "./admin/application/update-admin-role";
import { archiveAdminRole as archiveAdminRoleCommand } from "./admin/application/archive-admin-role";
import { listCapabilityDefinitions as listCapabilityDefinitionsQuery } from "./admin/application/list-capability-definitions";
import {
  listAdminCustomers as listAdminCustomersQuery,
  getAdminCustomer as getAdminCustomerQuery,
} from "./admin/application/list-admin-customers";
import {
  listCustomerInvitations as listCustomerInvitationsQuery,
  inviteCustomer as inviteCustomerCommand,
  changeCustomerAccess as changeCustomerAccessCommand,
  revokeCustomerSessions as revokeCustomerSessionsCommand,
  requestCustomerClosure as requestCustomerClosureCommand,
  listPrivacyRequests as listPrivacyRequestsQuery,
  applyPrivacyAction as applyPrivacyActionCommand,
} from "./admin/application/customer-commands";
import {
  listAdminPromotions as listAdminPromotionsQuery,
  getAdminPromotion as getAdminPromotionQuery,
  previewAdminPromotion as previewAdminPromotionQuery,
  listPromotionRedemptions as listPromotionRedemptionsQuery,
} from "./admin/application/promotion-reads";
import {
  createAdminPromotion as createAdminPromotionCommand,
  updateAdminPromotion as updateAdminPromotionCommand,
  changeAdminPromotionStatus as changeAdminPromotionStatusCommand,
  grantAdminPromotion as grantAdminPromotionCommand,
  listPromotionGrants as listPromotionGrantsQuery,
} from "./admin/application/promotion-commands";
import {
  listAdminCategories as listAdminCategoriesQuery,
  getAdminCategory as getAdminCategoryQuery,
  listAdminUnits as listAdminUnitsQuery,
  listAdminProducts as listAdminProductsQuery,
  getAdminProduct as getAdminProductQuery,
} from "./admin/application/catalog-reads";
import {
  createAdminCategory as createAdminCategoryCommand,
  updateAdminCategory as updateAdminCategoryCommand,
  setAdminCategoryStatus as setAdminCategoryStatusCommand,
  createAdminUnit as createAdminUnitCommand,
  createAdminProduct as createAdminProductCommand,
  updateAdminProduct as updateAdminProductCommand,
  setAdminProductStatus as setAdminProductStatusCommand,
  createAdminSku as createAdminSkuCommand,
  updateAdminSku as updateAdminSkuCommand,
  setAdminSkuAvailability as setAdminSkuAvailabilityCommand,
  setAdminSkuPrice as setAdminSkuPriceCommand,
} from "./admin/application/catalog-commands";
import {
  uploadAdminProductMedia as uploadAdminProductMediaCommand,
  updateAdminProductMedia as updateAdminProductMediaCommand,
  removeAdminProductMedia as removeAdminProductMediaCommand,
  getAdminProductMediaContent as getAdminProductMediaContentQuery,
} from "./admin/application/product-media";
import {
  listAdminInventory as listAdminInventoryQuery,
  getAdminInventoryLedger as getAdminInventoryLedgerQuery,
} from "./admin/application/catalog-reads";
import {
  listAdminOrders as listAdminOrdersQuery,
  getAdminOrder as getAdminOrderQuery,
  getAdminPayment as getAdminPaymentQuery,
  getAdminPaymentOverview as getAdminPaymentOverviewQuery,
  listAdminPayments as listAdminPaymentsQuery,
  listAdminReconciliationCases as listAdminReconciliationCasesQuery,
  listAdminMemberships as listAdminMembershipsQuery,
  getAdminMembership as getAdminMembershipQuery,
  listAdminOrderIssues as listAdminOrderIssuesQuery,
  getAdminOrderIssue as getAdminOrderIssueQuery,
} from "./admin/application/finance-reads";
import {
  cancelAdminOrder as cancelAdminOrderCommand,
  requestAdminRefund as requestAdminRefundCommand,
  recheckAdminRefund as recheckAdminRefundCommand,
  recheckAdminPayment as recheckAdminPaymentCommand,
  retryAdminProviderEvent as retryAdminProviderEventCommand,
  retryAdminPaymentReaction as retryAdminPaymentReactionCommand,
  resolveAdminReconciliationCase as resolveAdminReconciliationCaseCommand,
  changeAdminMembership as changeAdminMembershipCommand,
  applyAdminOrderIssueAction as applyAdminOrderIssueActionCommand,
} from "./admin/application/finance-commands";
import { getMembershipPriceConfiguration as getMembershipPriceConfigurationQuery } from "./admin/application/commerce-configuration";
import { buildHealthResponse, buildReadinessResponse } from "./runtime/readiness";
import { createCoreRpcContext } from "./entrypoint/context";
import { createAuthRpc } from "./entrypoint/auth-rpc";
import { createCatalogRpc } from "./entrypoint/catalog-rpc";
import { getAdminOverview as getAdminOverviewQuery } from "./admin/application/admin-overview";
import { createMembershipRpc } from "./entrypoint/membership-rpc";
import { getAdminSkuPrices as getAdminSkuPricesQuery } from "./admin/application/sku-prices";
import { createCheckoutRpc } from "./entrypoint/checkout-rpc";
import { createPaymentsRpc } from "./entrypoint/payments-rpc";
import { createOrdersRpc } from "./entrypoint/orders-rpc";
import { createInventoryTransfersRpc } from "./entrypoint/inventory-transfers-rpc";
import { createOperationsRpc } from "./entrypoint/operations-rpc";
import { listAnalyticsMetricDefinitions } from "./analytics/application/list-metric-definitions";
import { getAnalyticsOverview } from "./analytics/application/get-analytics-overview";
import { getMetricSeries } from "./analytics/application/get-metric-series";
import { handleGrabExpressWebhook } from "./delivery/http/grab-express-webhook";
import { handleLalamoveWebhook } from "./delivery/http/lalamove-webhook";

function fail(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

const adminAuditListRequestSchema = authenticatedRequestSchema.extend({
  action: validationSchema.string().trim().min(1).max(100).optional(),
  resourceType: validationSchema.string().trim().min(1).max(100).optional(),
  actorId: validationSchema.string().trim().min(1).max(200).optional(),
  marketId: validationSchema.string().trim().min(1).max(200).optional(),
  locationId: validationSchema.string().trim().min(1).max(200).optional(),
  from: validationSchema.string().trim().min(4).max(40).optional(),
  to: validationSchema.string().trim().min(4).max(40).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const adminAuditDetailRequestSchema = authenticatedRequestSchema.extend({
  auditEventId: validationSchema.string().trim().min(1).max(200),
});

const analyticsScopeSchema = validationSchema
  .union([
    validationSchema.object({ kind: validationSchema.literal("GLOBAL") }),
    validationSchema.object({
      kind: validationSchema.literal("MARKET"),
      marketId: validationSchema.string().trim().min(1).max(200),
    }),
    validationSchema.object({
      kind: validationSchema.literal("LOCATION"),
      marketId: validationSchema.string().trim().min(1).max(200),
      locationId: validationSchema.string().trim().min(1).max(200),
    }),
  ])
  .optional();
const analyticsWindowSchema = validationSchema.object({
  startAt: validationSchema.string().trim().min(1).max(100),
  endAt: validationSchema.string().trim().min(1).max(100),
  timezone: validationSchema.string().trim().min(1).max(100),
});
const analyticsDimensionsSchema = validationSchema
  .array(
    validationSchema.object({
      key: validationSchema.enum(analyticsDimensionKeys),
      value: validationSchema.string().trim().min(1).max(200),
    }),
  )
  .max(4)
  .optional();
const analyticsOverviewRequestSchema = authenticatedRequestSchema.extend({
  window: analyticsWindowSchema,
  scope: analyticsScopeSchema,
  dimensions: analyticsDimensionsSchema,
});
const metricDefinitionsRequestSchema = authenticatedRequestSchema.extend({
  category: validationSchema.enum(analyticsMetricCategories).optional(),
  status: validationSchema.enum(metricDefinitionStatuses).optional(),
  scope: analyticsScopeSchema,
});
const metricSeriesRequestSchema = analyticsOverviewRequestSchema.extend({
  metricCode: validationSchema.string().trim().min(1).max(100),
  definitionVersion: validationSchema.number().int().min(1).optional(),
});

const staffListRequestSchema = authenticatedRequestSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const staffDetailRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
});

const emailTextSchema = validationSchema
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "expected an email address");

const staffInvitationRevokeRequestSchema = authenticatedRequestSchema.extend({
  invitationId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().positive(),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const staffUpdateRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
  displayName: validationSchema.string().trim().min(1).max(120),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const staffAccessChangeRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum(["ACTIVATE", "SUSPEND"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const staffRolesRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
  roleIds: validationSchema.array(validationSchema.string().trim().min(1).max(200)).max(50),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const scopeInputSchema = validationSchema.union([
  validationSchema.object({ kind: validationSchema.literal("global") }),
  validationSchema.object({
    kind: validationSchema.literal("market"),
    marketId: validationSchema.string().trim().min(1).max(200),
  }),
  validationSchema.object({
    kind: validationSchema.literal("location"),
    locationId: validationSchema.string().trim().min(1).max(200),
  }),
]);

const staffInviteRequestSchema = authenticatedRequestSchema.extend({
  roleIds: validationSchema.array(validationSchema.string().trim().min(1).max(200)).min(1).max(10),
  scopes: validationSchema.array(scopeInputSchema).min(1).max(10),
  email: emailTextSchema,
  displayName: validationSchema.string().trim().min(1).max(120),
  idempotencyKey: idempotencyKeySchema,
});

const staffScopesRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
  scopes: validationSchema.array(scopeInputSchema).max(50),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const staffSessionRevocationRequestSchema = authenticatedRequestSchema.extend({
  staffId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const roleListRequestSchema = authenticatedRequestSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const roleDetailRequestSchema = authenticatedRequestSchema.extend({
  roleId: validationSchema.string().trim().min(1).max(200),
});

const roleCodeSchema = validationSchema
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_.-]*$/, "expected a role code");

const roleCreateRequestSchema = authenticatedRequestSchema.extend({
  code: roleCodeSchema,
  name: validationSchema.string().trim().min(1).max(120),
  description: validationSchema.string().trim().max(300),
  capabilityCodes: validationSchema.array(validationSchema.enum(adminCapabilityCodes)).max(50),
  idempotencyKey: idempotencyKeySchema,
});

const roleUpdateRequestSchema = authenticatedRequestSchema.extend({
  roleId: validationSchema.string().trim().min(1).max(200),
  name: validationSchema.string().trim().min(1).max(120),
  description: validationSchema.string().trim().max(300),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const roleCapabilitiesRequestSchema = authenticatedRequestSchema.extend({
  roleId: validationSchema.string().trim().min(1).max(200),
  capabilityCodes: validationSchema.array(validationSchema.enum(adminCapabilityCodes)).max(50),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const roleArchiveRequestSchema = authenticatedRequestSchema.extend({
  roleId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const customerListRequestSchema = authenticatedRequestSchema.extend({
  query: validationSchema.string().trim().min(1).max(100).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const customerDetailRequestSchema = authenticatedRequestSchema.extend({
  customerId: validationSchema.string().trim().min(1).max(200),
});

const customerInviteRequestSchema = authenticatedRequestSchema.extend({
  email: emailTextSchema,
  idempotencyKey: idempotencyKeySchema,
});

const customerAccessChangeRequestSchema = authenticatedRequestSchema.extend({
  customerId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum(["DISABLE", "RESTORE"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const customerSessionRevocationRequestSchema = authenticatedRequestSchema.extend({
  customerId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const closureRequestSchema = authenticatedRequestSchema.extend({
  customerId: validationSchema.string().trim().min(1).max(200),
  requestType: validationSchema.enum(["ACCESS", "CORRECTION", "CLOSURE", "ANONYMIZATION"]),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const privacyListRequestSchema = authenticatedRequestSchema.extend({
  customerId: validationSchema.string().trim().min(1).max(200).optional(),
  status: validationSchema
    .enum([
      "SUBMITTED",
      "VERIFYING",
      "APPROVED",
      "REJECTED",
      "PROCESSING",
      "COMPLETED",
      "ESCALATED",
    ])
    .optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const privacyActionRequestSchema = authenticatedRequestSchema.extend({
  privacyRequestId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum([
    "VERIFY",
    "APPROVE",
    "REJECT",
    "BEGIN_PROCESSING",
    "COMPLETE",
    "ESCALATE",
  ]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const promotionListRequestSchema = authenticatedRequestSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const promotionDetailRequestSchema = authenticatedRequestSchema.extend({
  promotionId: validationSchema.string().trim().min(1).max(200),
});

const promotionHistoryRequestSchema = promotionDetailRequestSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const promotionCreateRequestSchema = authenticatedRequestSchema
  .extend(adminPromotionCreateBodySchema.shape)
  .extend({ idempotencyKey: idempotencyKeySchema });

const promotionUpdateRequestSchema = authenticatedRequestSchema
  .extend(adminPromotionUpdateBodySchema.shape)
  .extend({
    promotionId: validationSchema.string().trim().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
  });

const promotionStatusChangeRequestSchema = authenticatedRequestSchema
  .extend(adminPromotionStatusBodySchema.shape)
  .extend({
    promotionId: validationSchema.string().trim().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
  });

const promotionPreviewRequestSchema = authenticatedRequestSchema
  .extend(adminPromotionPreviewBodySchema.shape)
  .extend({ promotionId: validationSchema.string().trim().min(1).max(200) });

const promotionGrantRequestSchema = authenticatedRequestSchema
  .extend(adminPromotionGrantBodySchema.shape)
  .extend({
    promotionId: validationSchema.string().trim().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
  });

const catalogCategoryCreateSchema = authenticatedRequestSchema
  .extend(adminCategoryCreateBodySchema.shape)
  .extend({ idempotencyKey: idempotencyKeySchema });

const catalogCategoryListSchema = authenticatedRequestSchema.extend({
  query: validationSchema.string().trim().min(1).max(100).optional(),
  status: validationSchema.enum(["active", "inactive"]).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const catalogCategoryDetailSchema = authenticatedRequestSchema.extend({
  categoryId: validationSchema.string().trim().min(1).max(200),
});

const catalogCategoryUpdateSchema = catalogCategoryDetailSchema
  .extend(adminCategoryUpdateBodySchema.shape)
  .extend({ idempotencyKey: idempotencyKeySchema });
const catalogCategoryStatusSchema = catalogCategoryDetailSchema
  .extend(adminCategoryStatusBodySchema.shape)
  .extend({ idempotencyKey: idempotencyKeySchema });

const catalogUnitCreateSchema = authenticatedRequestSchema.extend({
  code: validationSchema
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Z][A-Z0-9_]*$/, "expected UPPER_SNAKE_CASE code"),
  displayName: validationSchema.string().trim().min(1).max(60),
  dimension: validationSchema.enum(["MASS", "COUNT", "VOLUME"]),
  canonicalBaseCode: validationSchema.enum(["GRAM", "MILLILITER", "PIECE"]),
  conversionNumerator: validationSchema.number().int().min(1),
  conversionDenominator: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const catalogProductListFields = {
  query: validationSchema.string().trim().min(1).max(100).optional(),
  status: validationSchema.enum(["active", "inactive"]).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
};
const catalogProductListSchema = validationSchema.discriminatedUnion("scopeKind", [
  authenticatedRequestSchema.extend({
    scopeKind: validationSchema.literal("GLOBAL"),
    ...catalogProductListFields,
  }),
  authenticatedRequestSchema.extend({
    scopeKind: validationSchema.literal("LOCATION"),
    marketId: validationSchema.string().trim().min(1).max(200),
    locationId: validationSchema.string().trim().min(1).max(200),
    ...catalogProductListFields,
  }),
]);

const adminSelectedScopeSchema = validationSchema.discriminatedUnion("kind", [
  validationSchema.object({ kind: validationSchema.literal("GLOBAL") }),
  validationSchema.object({
    kind: validationSchema.literal("MARKET"),
    marketId: validationSchema.string().trim().min(1).max(200),
  }),
  validationSchema.object({
    kind: validationSchema.literal("LOCATION"),
    marketId: validationSchema.string().trim().min(1).max(200),
    locationId: validationSchema.string().trim().min(1).max(200),
  }),
]);

const adminOverviewSchema = authenticatedRequestSchema.extend({
  selectedScope: adminSelectedScopeSchema,
  timezone: validationSchema.string().trim().min(1).max(100),
});

const adminBootstrapSchema = authenticatedRequestSchema.extend({
  selectedScope: adminSelectedScopeSchema.optional(),
  timezone: validationSchema.string().trim().min(1).max(100),
});

const catalogProductCreateSchema = authenticatedRequestSchema
  .extend(adminProductCreateBodySchema.shape)
  .extend({ idempotencyKey: idempotencyKeySchema });
const catalogProductUpdateSchema = authenticatedRequestSchema
  .extend(adminProductUpdateBodySchema.shape)
  .extend({
    productId: validationSchema.string().trim().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
  });

const catalogProductDetailSchema = validationSchema.discriminatedUnion("scopeKind", [
  authenticatedRequestSchema.extend({
    scopeKind: validationSchema.literal("GLOBAL"),
    productId: validationSchema.string().trim().min(1).max(200),
  }),
  authenticatedRequestSchema.extend({
    scopeKind: validationSchema.literal("LOCATION"),
    productId: validationSchema.string().trim().min(1).max(200),
    marketId: validationSchema.string().trim().min(1).max(200),
    locationId: validationSchema.string().trim().min(1).max(200),
  }),
]);

const catalogProductStatusSchema = authenticatedRequestSchema
  .extend(adminProductStatusBodySchema.shape)
  .extend({
    productId: validationSchema.string().trim().min(1).max(200),
    idempotencyKey: idempotencyKeySchema,
  });

const catalogProductMediaMetadataSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
  mediaId: validationSchema.string().trim().min(1).max(200),
  altText: validationSchema.string().trim().min(1).max(300),
  isPrimary: validationSchema.boolean(),
  sortOrder: validationSchema.number().int().min(0).max(10_000),
  expectedProductVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const catalogProductMediaUploadSchema = catalogProductMediaMetadataSchema
  .omit({ mediaId: true })
  .extend({
    replaceMediaId: validationSchema.string().trim().min(1).max(200).optional(),
    bytes: validationSchema.instanceof(ArrayBuffer),
    mimeType: validationSchema.enum(["image/jpeg", "image/png", "image/webp"]),
  });

const catalogProductMediaRemoveSchema = catalogProductMediaMetadataSchema.pick({
  requestId: true,
  headers: true,
  productId: true,
  mediaId: true,
  expectedProductVersion: true,
  idempotencyKey: true,
});

const catalogProductMediaContentSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
  mediaId: validationSchema.string().trim().min(1).max(200),
  locationId: validationSchema.string().trim().min(1).max(200).optional(),
});

const catalogSkuCreateSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
  code: validationSchema.string().trim().min(1).max(80),
  name: validationSchema.string().trim().min(1).max(120),
  sellableUnitId: validationSchema.string().trim().min(1).max(200),
  sellQuantity: validationSchema.number().int().min(1),
  consumptionBaseQuantity: validationSchema.number().int().min(1),
  estimatedShippingWeightGrams: validationSchema.number().int().min(1).optional(),
  merchandisingLabel: validationSchema.string().trim().max(60).nullable().optional(),
  sortOrder: validationSchema.number().int().min(0).max(10000).optional(),
  idempotencyKey: idempotencyKeySchema,
});

const catalogSkuUpdateSchema = authenticatedRequestSchema.extend({
  skuId: validationSchema.string().trim().min(1).max(200),
  name: validationSchema.string().trim().min(1).max(120).optional(),
  merchandisingLabel: validationSchema.string().trim().max(60).nullable().optional(),
  status: validationSchema.enum(["active", "inactive"]).optional(),
  sortOrder: validationSchema.number().int().min(0).max(10000).optional(),
  estimatedShippingWeightGrams: validationSchema.number().int().min(1).optional(),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const catalogSkuAvailabilitySchema = authenticatedRequestSchema.extend({
  skuId: validationSchema.string().trim().min(1).max(200),
  locationId: validationSchema.string().trim().min(1).max(200),
  availabilityStatus: validationSchema.enum(["AVAILABLE", "UNAVAILABLE"]),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const catalogSkuPriceSchema = authenticatedRequestSchema.extend({
  skuId: validationSchema.string().trim().min(1).max(200),
  marketId: validationSchema.string().trim().min(1).max(200),
  locationId: validationSchema.string().trim().min(1).max(200),
  currency: validationSchema.string().trim().length(3),
  amountMinor: validationSchema.number().int().min(1),
  validFrom: validationSchema.number().int().min(1),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const inventoryListSchema = authenticatedRequestSchema.extend({
  locationId: validationSchema.string().trim().min(1).max(200),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const inventoryLedgerSchema = authenticatedRequestSchema.extend({
  locationId: validationSchema.string().trim().min(1).max(200),
  inventoryPoolId: validationSchema.string().trim().min(1).max(200),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});
const adminOperationsLocationSchema = authenticatedRequestSchema.extend({
  locationId: validationSchema.string().trim().min(1).max(200),
});
const adminOperationsCycleSchema = adminOperationsLocationSchema.extend({
  cycleId: validationSchema.string().trim().min(1).max(200).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});
const locationDeliveryProfileSchema = adminOperationsLocationSchema.extend({
  senderName: validationSchema.string().trim().min(1).max(120),
  phoneE164: validationSchema
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/),
  email: validationSchema.string().trim().email().max(254).nullable().optional(),
  formattedAddress: validationSchema.string().trim().min(1).max(500),
  addressLine1: validationSchema.string().trim().min(1).max(200),
  addressLine2: validationSchema.string().trim().max(200).nullable().optional(),
  barangay: validationSchema.string().trim().max(120).nullable().optional(),
  city: validationSchema.string().trim().min(1).max(120),
  region: validationSchema.string().trim().max(120).nullable().optional(),
  postalCode: validationSchema.string().trim().max(20).nullable().optional(),
  countryCode: validationSchema.string().trim().length(2),
  pickupInstructions: validationSchema.string().trim().max(1000).nullable().optional(),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});
const requestExternalDeliverySchema = adminOperationsLocationSchema.extend({
  jobId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(1),
  providerCode: validationSchema.literal("lalamove"),
  pickup: validationSchema.discriminatedUnion("kind", [
    validationSchema.object({ kind: validationSchema.literal("IMMEDIATE") }),
    validationSchema.object({
      kind: validationSchema.literal("SCHEDULED"),
      pickupAt: validationSchema.string().datetime({ offset: true }),
    }),
  ]),
  idempotencyKey: idempotencyKeySchema,
});
const externalDeliveryMutationSchema = adminOperationsLocationSchema.extend({
  dispatchId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});
const adminOperationalExceptionsSchema = adminOperationsLocationSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});
const commerceTransitionSchema = authenticatedRequestSchema.extend({
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500),
});
const activateGlobalModeSchema = commerceTransitionSchema.extend({
  fulfillmentMode: validationSchema.enum(["INSTANT", "SCHEDULED"]),
  cadence: validationSchema.enum(["WEEKLY"]).nullable().optional(),
});
const adminProcurementAggregateSchema = adminOperationsLocationSchema.extend({
  cycleId: validationSchema.string().trim().min(1).max(200),
  inventoryPoolId: validationSchema.string().trim().min(1).max(200),
  skuId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminReceivingStartSchema = adminOperationsLocationSchema.extend({
  requirementId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminReceivingLineSchema = adminOperationsLocationSchema.extend({
  receiptKind: validationSchema.enum(["DELIVERY", "REPLACEMENT"]).optional(),
  shortageBase: validationSchema.number().int().safe().nonnegative().optional(),
  receivingSessionId: validationSchema.string().trim().min(1).max(200),
  acceptedBase: validationSchema.number().int().min(0),
  rejectedBase: validationSchema.number().int().min(0),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminReceivingCompleteSchema = adminOperationsLocationSchema.extend({
  receivingSessionId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminFulfillmentAdvanceSchema = adminOperationsLocationSchema.extend({
  orderId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum([
    "START_PICKING",
    "MARK_READY_TO_PACK",
    "START_PACKING",
    "MARK_PACKED",
    "HAND_OFF",
    "COMPLETE",
    "RECORD_SHORTAGE",
    "RESUME_PICKING",
    "RESUME_READY_TO_PACK",
    "CANCEL",
    "ESCALATE",
  ]),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminOperationalExceptionResolveSchema = adminOperationsLocationSchema.extend({
  kind: validationSchema.literal("FULFILLMENT_SHORTAGE"),
  action: validationSchema.literal("RETRY_FULFILLMENT"),
  orderId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500),
});

const orderListSchema = authenticatedRequestSchema.extend({
  status: validationSchema.string().trim().min(1).max(60).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const orderDetailSchema = authenticatedRequestSchema.extend({
  orderId: validationSchema.string().trim().min(1).max(200),
});

const orderCancelSchema = authenticatedRequestSchema.extend({
  orderId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500).optional(),
  reasonCode: validationSchema.string().trim().min(1).max(120).optional(),
  resolution: validationSchema.string().trim().min(1).max(500).optional(),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const paymentListSchema = authenticatedRequestSchema.extend({
  status: validationSchema
    .enum([
      "INITIATED",
      "REQUIRES_ACTION",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "EXPIRED",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
    ])
    .optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const paymentDetailSchema = authenticatedRequestSchema.extend({
  paymentIntentId: validationSchema.string().trim().min(1).max(200),
});

const refundRequestSchema = authenticatedRequestSchema.extend({
  expectedVersion: validationSchema.number().int().safe().positive(),
  paymentIntentId: validationSchema.string().trim().min(1).max(200),
  amountMinor: validationSchema.number().int().safe().min(1),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const refundRecheckSchema = authenticatedRequestSchema.extend({
  refundId: validationSchema.string().trim().min(1).max(200),
  expectedVersion: validationSchema.number().int().safe().positive(),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const reconciliationListSchema = authenticatedRequestSchema.extend({
  status: validationSchema.enum(["OPEN", "RESOLVED"]).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const reconciliationResolveSchema = authenticatedRequestSchema.extend({
  expectedVersion: validationSchema.number().int().safe().positive(),
  caseId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const membershipListSchema = authenticatedRequestSchema.extend({
  query: validationSchema.string().trim().min(1).max(100).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const membershipDetailSchema = authenticatedRequestSchema.extend({
  subscriptionId: validationSchema.string().trim().min(1).max(200),
});

const membershipLifecycleSchema = authenticatedRequestSchema.extend({
  subscriptionId: validationSchema.string().trim().min(1).max(200),
  timing: validationSchema.enum(["IMMEDIATE", "PERIOD_END"]).optional(),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const membershipPriceConfigurationSchema = authenticatedRequestSchema.extend({
  expectedVersion: validationSchema.number().int().min(1),
  amountMinor: validationSchema.number().int().min(1),
  currency: validationSchema
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  effectiveFrom: validationSchema.string().datetime(),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const issueListSchema = authenticatedRequestSchema.extend({
  status: validationSchema
    .enum(["SUBMITTED", "CLAIMED", "INVESTIGATING", "RESOLVED", "ESCALATED"])
    .optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const issueDetailSchema = authenticatedRequestSchema.extend({
  issueId: validationSchema.string().trim().min(1).max(200),
});

const issueActionSchema = authenticatedRequestSchema.extend({
  issueId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum(["CLAIM", "RESOLVE"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

export { buildHealthResponse, buildReadinessResponse } from "./runtime/readiness";

/**
 * Worker transport and dependency composition only. Every RPC validates its
 * boundary schema, resolves authentication/authorization through the
 * application context, and delegates to the owning bounded-context module;
 * domain behavior lives beside its context, never here.
 */
export class CoreEntrypoint extends WorkerEntrypoint<Env> {
  // Instance functions stay internal to Worker RPC; prototype getters are exposed.
  protected createGeocoderPort = (): GeocoderPort => buildGeocoderPort(this.env);
  private readonly rpcContext = createCoreRpcContext(
    this.env as Env & AuthEnvironment,
    systemClock,
  );
  private readonly runtimeConfiguration = this.rpcContext.runtimeConfiguration;
  private readonly context = this.rpcContext.access;
  private readonly authRpc = createAuthRpc(this.rpcContext);
  private readonly catalogRpc = createCatalogRpc(this.rpcContext);
  private readonly membershipRpc = createMembershipRpc(this.rpcContext);
  private readonly checkoutRpc = createCheckoutRpc(this.rpcContext);
  private readonly paymentsRpc = createPaymentsRpc(this.rpcContext);
  private readonly ordersRpc = createOrdersRpc(this.rpcContext);
  private readonly inventoryTransfersRpc = createInventoryTransfersRpc(this.rpcContext);
  private readonly operationsRpc = createOperationsRpc(this.rpcContext);

  async getAdminOverview(input: import("@freshmarkets/contracts").AdminOverviewRequest) {
    return observeCoreRpc("admin.overview", input.requestId, async () => {
      const validation = adminOverviewSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return getAdminOverviewQuery(
        { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
        validation.data,
      );
    });
  }

  async getAdminBootstrap(input: import("@freshmarkets/contracts").AdminBootstrapRequest) {
    return observeCoreRpc("admin.bootstrap", input.requestId, async () => {
      const validation = adminBootstrapSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return getAdminBootstrapQuery(
        {
          auth: createAuth(this.env as Env & AuthEnvironment),
          db: this.env.DB,
          environment:
            this.runtimeConfiguration().environment === "test"
              ? "development"
              : this.runtimeConfiguration().environment,
        },
        validation.data,
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const id = requestId(request);
    const path = new URL(request.url).pathname;
    if (path === "/health")
      return Response.json(await this.health({ requestId: id }), {
        headers: { "x-request-id": id },
      });
    if (path === "/ready") {
      const readiness = await this.readiness({ requestId: id });
      return Response.json(readiness, {
        status: readiness.status === "ready" ? 200 : 503,
        headers: { "x-request-id": id },
      });
    }
    if (path.startsWith("/webhooks/payments/"))
      return handleProviderWebhook(
        this.env.DB,
        buildProviderRegistry(this.runtimeConfiguration()),
        request,
        id,
      );
    if (path === "/webhooks/delivery/grab-express")
      return handleGrabExpressWebhook(this.env.DB, this.env, request, id);
    if (path === "/webhooks/delivery/lalamove")
      return handleLalamoveWebhook(this.env.DB, this.env, request, id);
    if (path.startsWith("/api/auth"))
      return createAuth(this.env as Env & AuthEnvironment).handler(request);
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Core route not found", requestId: id } },
      { status: 404, headers: { "x-request-id": id } },
    );
  }
  async health(meta?: RequestMeta): Promise<CoreHealthResponse> {
    const response = buildHealthResponse(this.env);
    log("info", "core.health", {
      requestId: meta?.requestId ?? crypto.randomUUID(),
      environment: response.environment,
      databaseBindingConfigured: response.databaseBindingConfigured,
    });
    return response;
  }
  async readiness(meta?: RequestMeta): Promise<CoreReadinessResponse> {
    const response = await buildReadinessResponse(this.env);
    log(response.status === "ready" ? "info" : "warn", "core.readiness", {
      requestId: meta?.requestId ?? crypto.randomUUID(),
      environment: response.environment,
      runtimeConfiguration: response.checks.runtimeConfiguration,
      database: response.checks.database,
      paymentProvider: response.checks.paymentProvider.status,
      paymentProviderCode: response.checks.paymentProvider.code ?? "none",
    });
    return response;
  }
  async auth(input: AuthRequest): Promise<AuthResponse> {
    return this.authRpc.auth(input);
  }
  async getApplicationContext(input: AuthContextRequest) {
    return this.authRpc.getApplicationContext(input);
  }
  async getAdminContext(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    return observeCoreRpc("admin.context", input.requestId, async () => {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return getAdminContextQuery(
        {
          auth: createAuth(this.env as Env & AuthEnvironment),
          db: this.env.DB,
          environment:
            this.runtimeConfiguration().environment === "test"
              ? "development"
              : this.runtimeConfiguration().environment,
        },
        validation.data,
      );
    });
  }
  async listAdminScopes(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    return observeCoreRpc("admin.scopes", input.requestId, async () => {
      const validation = authenticatedRequestSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return listAdminScopesQuery(
        {
          auth: createAuth(this.env as Env & AuthEnvironment),
          db: this.env.DB,
          environment:
            this.runtimeConfiguration().environment === "test"
              ? "development"
              : this.runtimeConfiguration().environment,
        },
        validation.data,
      );
    });
  }
  async listMetricDefinitions(
    input: import("@freshmarkets/contracts").ListMetricDefinitionsRequest,
  ) {
    const validation = metricDefinitionsRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAnalyticsMetricDefinitions(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getOverview(input: import("@freshmarkets/contracts").AnalyticsOverviewRequest) {
    const validation = analyticsOverviewRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAnalyticsOverview(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAnalyticsOverview(input: import("@freshmarkets/contracts").AnalyticsOverviewRequest) {
    return this.getOverview(input);
  }
  async getMetric(input: import("@freshmarkets/contracts").MetricSeriesRequest) {
    const validation = metricSeriesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getMetricSeries(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getMetricSeries(input: import("@freshmarkets/contracts").MetricSeriesRequest) {
    return this.getMetric(input);
  }
  async listAdminAuditEvents(input: import("@freshmarkets/contracts").AdminAuditListRequest) {
    const validation = adminAuditListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminAuditEventsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminAuditEvent(input: import("@freshmarkets/contracts").AdminAuditDetailRequest) {
    const validation = adminAuditDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminAuditEventQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminStaff(input: import("@freshmarkets/contracts").AdminStaffListRequest) {
    const validation = staffListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminStaffQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminStaff(input: import("@freshmarkets/contracts").AdminStaffDetailRequest) {
    const validation = staffDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminStaffQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminStaffInvitations(
    input: import("@freshmarkets/contracts").AdminStaffInvitationListRequest,
  ) {
    const validation = staffListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminStaffInvitationsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getInitialAdministratorSetup(
    input: import("@freshmarkets/contracts").AuthenticatedRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getInitialAdministratorSetup(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        configuredEmail: this.env.INITIAL_GLOBAL_ADMIN_EMAIL,
      },
      validation.data,
    );
  }
  async completeInitialAdministratorSetup(
    input: import("@freshmarkets/contracts").CompleteInitialAdministratorSetupRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({
        expectedVersion: validationSchema.literal(0),
        idempotencyKey: idempotencyKeySchema,
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return completeInitialAdministratorSetup(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        configuredEmail: this.env.INITIAL_GLOBAL_ADMIN_EMAIL,
      },
      validation.data,
    );
  }
  async getMyStaffInvitation(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getMyStaffInvitation(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async acceptStaffInvitation(
    input: import("@freshmarkets/contracts").AcceptStaffInvitationRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({
        invitationId: validationSchema.string().trim().min(1).max(200),
        expectedVersion: validationSchema.number().int().min(1),
        idempotencyKey: idempotencyKeySchema,
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return acceptStaffInvitation(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async inviteAdminStaff(input: import("@freshmarkets/contracts").AdminStaffInviteRequest) {
    const validation = staffInviteRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return inviteAdminStaffCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async revokeAdminStaffInvitation(
    input: import("@freshmarkets/contracts").AdminStaffInvitationRevokeRequest,
  ) {
    const validation = staffInvitationRevokeRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return revokeAdminStaffInvitationCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminStaff(input: import("@freshmarkets/contracts").AdminStaffUpdateRequest) {
    const validation = staffUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminStaffCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async changeAdminStaffAccess(
    input: import("@freshmarkets/contracts").AdminStaffAccessChangeRequest,
  ) {
    const validation = staffAccessChangeRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeAdminStaffAccessCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminStaffRoles(input: import("@freshmarkets/contracts").AdminStaffRolesRequest) {
    const validation = staffRolesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminStaffRolesCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminStaffScopes(input: import("@freshmarkets/contracts").AdminStaffScopesRequest) {
    const validation = staffScopesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminStaffScopesCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async revokeAdminStaffSessions(
    input: import("@freshmarkets/contracts").AdminStaffSessionRevocationRequest,
  ) {
    const validation = staffSessionRevocationRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return revokeAdminStaffSessionsCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminRoles(input: import("@freshmarkets/contracts").AdminRoleListRequest) {
    const validation = roleListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminRolesQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminRole(input: import("@freshmarkets/contracts").AdminRoleDetailRequest) {
    const validation = roleDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminRoleQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async createAdminRole(input: import("@freshmarkets/contracts").AdminRoleCreateRequest) {
    const validation = roleCreateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminRoleCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminRole(input: import("@freshmarkets/contracts").AdminRoleUpdateRequest) {
    const validation = roleUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminRoleCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminRoleCapabilities(
    input: import("@freshmarkets/contracts").AdminRoleCapabilitiesRequest,
  ) {
    const validation = roleCapabilitiesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminRoleCapabilitiesCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async archiveAdminRole(input: import("@freshmarkets/contracts").AdminRoleArchiveRequest) {
    const validation = roleArchiveRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return archiveAdminRoleCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listCapabilityDefinitions(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listCapabilityDefinitionsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminCustomers(input: import("@freshmarkets/contracts").AdminCustomerListRequest) {
    const validation = customerListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminCustomersQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminCustomer(input: import("@freshmarkets/contracts").AdminCustomerDetailRequest) {
    const validation = customerDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminCustomerQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminCustomerProfile(
    input: import("@freshmarkets/contracts").AdminCustomerDetailRequest,
  ) {
    const validation = customerDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminCustomerProfile(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminCustomerProfile(
    input: import("@freshmarkets/contracts").AdminCustomerProfileUpdateRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const { headers: _headers, requestId: _requestId, ...command } = input;
    return updateAdminCustomerProfile(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
      command,
    );
  }
  async listCustomerSupportNotes(
    input: import("@freshmarkets/contracts").CustomerSupportNoteListRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const { headers: _headers, requestId: _requestId, ...query } = input;
    return listCustomerSupportNotes(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
      query,
    );
  }
  async appendCustomerSupportNote(
    input: import("@freshmarkets/contracts").AppendCustomerSupportNoteRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const { headers: _headers, requestId: _requestId, ...command } = input;
    return appendCustomerSupportNote(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
      command,
    );
  }
  async listCustomerInvitations(
    input: import("@freshmarkets/contracts").AdminCustomerInvitationListRequest,
  ) {
    const validation = customerListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listCustomerInvitationsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async inviteCustomer(input: import("@freshmarkets/contracts").AdminCustomerInviteRequest) {
    const validation = customerInviteRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return inviteCustomerCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getMyCustomerInvitation(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getMyCustomerInvitation(
      {
        database: this.env.DB,
        session: (request) => this.context.session(request),
        now: () => this.context.now(),
      },
      validation.data,
    );
  }
  async getMyCustomerProfile(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(validation.data);
    if (!customer.ok) return customer;
    const value = await readCustomerProfile(this.env.DB, customer.value.customerId);
    return value
      ? { ok: true as const, value, requestId: input.requestId }
      : fail("NOT_FOUND", "Customer profile not found", input.requestId);
  }
  async updateMyCustomerProfile(
    input: import("@freshmarkets/contracts").UpdateCustomerProfileRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const { headers: _headers, requestId: _requestId, ...command } = input;
    return updateMyCustomerProfile(
      {
        database: this.env.DB,
        session: (request) => this.context.session(request),
        now: () => this.context.now(),
      },
      validation.data,
      command,
    );
  }
  async manageMyCustomerAddress(
    input: import("@freshmarkets/contracts").ManageCustomerAddressRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const { headers: _headers, requestId: _requestId, ...command } = input;
    return manageMyCustomerAddress(
      {
        database: this.env.DB,
        session: (request) => this.context.session(request),
        now: () => this.context.now(),
      },
      validation.data,
      command,
    );
  }
  async acceptCustomerInvitation(
    input: import("@freshmarkets/contracts").AcceptCustomerInvitationRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({
        invitationId: validationSchema.string().trim().min(1).max(200),
        expectedVersion: validationSchema.number().int().positive(),
        idempotencyKey: idempotencyKeySchema,
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return acceptCustomerInvitation(
      {
        database: this.env.DB,
        session: (request) => this.context.session(request),
        now: () => this.context.now(),
      },
      validation.data,
    );
  }
  async revokeCustomerInvitation(
    input: import("@freshmarkets/contracts").RevokeCustomerInvitationRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({
        invitationId: validationSchema.string().trim().min(1).max(200),
        expectedVersion: validationSchema.number().int().positive(),
        reason: validationSchema.string().trim().min(1).max(500),
        idempotencyKey: idempotencyKeySchema,
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return revokeCustomerInvitation(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async changeCustomerAccess(
    input: import("@freshmarkets/contracts").AdminCustomerAccessChangeRequest,
  ) {
    const validation = customerAccessChangeRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeCustomerAccessCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async revokeCustomerSessions(
    input: import("@freshmarkets/contracts").AdminCustomerSessionRevocationRequest,
  ) {
    const validation = customerSessionRevocationRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return revokeCustomerSessionsCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async requestCustomerClosure(
    input: import("@freshmarkets/contracts").AdminClosureRequestCommand,
  ) {
    const validation = closureRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return requestCustomerClosureCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listPrivacyRequests(input: import("@freshmarkets/contracts").AdminPrivacyListRequest) {
    const validation = privacyListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listPrivacyRequestsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async applyPrivacyAction(input: import("@freshmarkets/contracts").AdminPrivacyActionRequest) {
    const validation = privacyActionRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return applyPrivacyActionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminBannerMedia(
    input: Parameters<
      import("@freshmarkets/contracts").BannerMediaService["getAdminBannerMedia"]
    >[0],
  ) {
    return getAdminBannerMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async uploadAdminBannerMedia(
    input: Parameters<
      import("@freshmarkets/contracts").BannerMediaService["uploadAdminBannerMedia"]
    >[0],
  ) {
    return uploadAdminBannerMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async updateAdminBannerMedia(
    input: Parameters<
      import("@freshmarkets/contracts").BannerMediaService["updateAdminBannerMedia"]
    >[0],
  ) {
    return updateAdminBannerMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async removeAdminBannerMedia(
    input: Parameters<
      import("@freshmarkets/contracts").BannerMediaService["removeAdminBannerMedia"]
    >[0],
  ) {
    return removeAdminBannerMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async getAdminBannerMediaContent(
    input: Parameters<
      import("@freshmarkets/contracts").BannerMediaService["getAdminBannerMediaContent"]
    >[0],
  ) {
    return getAdminBannerMediaContent(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async getPublishedBannerMedia(
    input: import("@freshmarkets/contracts").PublishedBannerMediaRequest,
  ) {
    return getPublishedBannerMedia(this.env.DB, this.env.PRODUCT_MEDIA, input);
  }
  async listPublishedBanners(input: { requestId: string }) {
    return listPublishedBanners(this.env.DB, input);
  }
  async getAdminPromotionMedia(
    input: Parameters<
      import("@freshmarkets/contracts").PromotionMediaService["getAdminPromotionMedia"]
    >[0],
  ) {
    return getAdminPromotionMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async uploadAdminPromotionMedia(
    input: Parameters<
      import("@freshmarkets/contracts").PromotionMediaService["uploadAdminPromotionMedia"]
    >[0],
  ) {
    return uploadAdminPromotionMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async updateAdminPromotionMedia(
    input: Parameters<
      import("@freshmarkets/contracts").PromotionMediaService["updateAdminPromotionMedia"]
    >[0],
  ) {
    return updateAdminPromotionMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async removeAdminPromotionMedia(
    input: Parameters<
      import("@freshmarkets/contracts").PromotionMediaService["removeAdminPromotionMedia"]
    >[0],
  ) {
    return removeAdminPromotionMedia(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async getAdminPromotionMediaContent(
    input: Parameters<
      import("@freshmarkets/contracts").PromotionMediaService["getAdminPromotionMediaContent"]
    >[0],
  ) {
    return getAdminPromotionMediaContent(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      input,
    );
  }
  async getPublishedPromotionMedia(
    input: import("@freshmarkets/contracts").PublishedPromotionMediaRequest,
  ) {
    return getPublishedPromotionMedia(this.env.DB, this.env.PRODUCT_MEDIA, input);
  }
  async listPublishedPromotionCampaigns(input: { requestId: string }) {
    return listPublishedPromotionCampaigns(this.env.DB, input);
  }
  async listAdminBanners(
    input: Parameters<
      import("@freshmarkets/contracts").StorefrontBannerService["listAdminBanners"]
    >[0],
  ) {
    return listAdminBanners(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async saveAdminBanner(
    input: Parameters<
      import("@freshmarkets/contracts").StorefrontBannerService["saveAdminBanner"]
    >[0],
  ) {
    return saveAdminBanner(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminPromotions(input: import("@freshmarkets/contracts").AdminPromotionListRequest) {
    const validation = promotionListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminPromotionsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminPromotion(input: import("@freshmarkets/contracts").AdminPromotionDetailRequest) {
    const validation = promotionDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminPromotionQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminPromotionAudience(
    input: import("@freshmarkets/contracts").AdminPromotionAudienceRequest,
  ) {
    return getAdminPromotionAudienceQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async setAdminPromotionAudience(
    input: import("@freshmarkets/contracts").AdminPromotionAudienceUpdateRequest,
  ) {
    return setAdminPromotionAudienceCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async createAdminPromotion(input: import("@freshmarkets/contracts").AdminPromotionCreateRequest) {
    const validation = promotionCreateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminPromotionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminPromotion(input: import("@freshmarkets/contracts").AdminPromotionUpdateRequest) {
    const validation = promotionUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminPromotionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async changeAdminPromotionStatus(
    input: import("@freshmarkets/contracts").AdminPromotionStatusChangeRequest,
  ) {
    const validation = promotionStatusChangeRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeAdminPromotionStatusCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async previewAdminPromotion(
    input: import("@freshmarkets/contracts").AdminPromotionPreviewRequest,
  ) {
    const validation = promotionPreviewRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return previewAdminPromotionQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async grantAdminPromotion(input: import("@freshmarkets/contracts").AdminPromotionGrantRequest) {
    const validation = promotionGrantRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return grantAdminPromotionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listPromotionGrants(
    input: import("@freshmarkets/contracts").AdminPromotionDetailRequest & {
      cursor?: string;
      limit?: number;
    },
  ) {
    const validation = promotionHistoryRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listPromotionGrantsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listPromotionRedemptions(
    input: import("@freshmarkets/contracts").AdminPromotionDetailRequest & {
      cursor?: string;
      limit?: number;
    },
  ) {
    const validation = promotionHistoryRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listPromotionRedemptionsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminCategories(input: import("@freshmarkets/contracts").AdminCategoryListRequest) {
    const validation = catalogCategoryListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminCategoriesQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async createAdminCategory(input: import("@freshmarkets/contracts").AdminCategoryCreateRequest) {
    const validation = catalogCategoryCreateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminCategoryCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminCategory(input: import("@freshmarkets/contracts").AdminCategoryDetailRequest) {
    const validation = catalogCategoryDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminCategoryQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminCategory(input: import("@freshmarkets/contracts").AdminCategoryUpdateRequest) {
    const validation = catalogCategoryUpdateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminCategoryCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminCategoryStatus(
    input: import("@freshmarkets/contracts").AdminCategoryStatusRequest,
  ) {
    const validation = catalogCategoryStatusSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminCategoryStatusCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminUnits(input: import("@freshmarkets/contracts").AdminUnitListRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminUnitsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async createAdminUnit(input: import("@freshmarkets/contracts").AdminUnitCreateRequest) {
    const validation = catalogUnitCreateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminUnitCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminProducts(input: import("@freshmarkets/contracts").AdminProductListRequest) {
    return observeCoreRpc("admin.products.list", input.requestId, async () => {
      const validation = catalogProductListSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return listAdminProductsQuery(
        { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
        validation.data,
      );
    });
  }
  async createAdminProduct(input: import("@freshmarkets/contracts").AdminProductCreateRequest) {
    return observeCoreRpc("admin.products.create", input.requestId, async () => {
      const validation = catalogProductCreateSchema.safeParse(input);
      if (!validation.success)
        return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
      return createAdminProductCommand(
        { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
        validation.data,
      );
    });
  }
  async getAdminProduct(input: import("@freshmarkets/contracts").AdminProductDetailRequest) {
    const validation = catalogProductDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminProductQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminProduct(input: import("@freshmarkets/contracts").AdminProductUpdateRequest) {
    const validation = catalogProductUpdateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminProductCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminProductStatus(input: import("@freshmarkets/contracts").AdminProductStatusRequest) {
    const validation = catalogProductStatusSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminProductStatusCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async uploadAdminProductMedia(
    input: import("@freshmarkets/contracts").AdminProductMediaUploadRequest,
  ) {
    const validation = catalogProductMediaUploadSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return uploadAdminProductMediaCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      validation.data,
    );
  }
  async updateAdminProductMedia(
    input: import("@freshmarkets/contracts").AdminProductMediaUpdateRequest,
  ) {
    const validation = catalogProductMediaMetadataSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminProductMediaCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      validation.data,
    );
  }
  async removeAdminProductMedia(
    input: import("@freshmarkets/contracts").AdminProductMediaRemoveRequest,
  ) {
    const validation = catalogProductMediaRemoveSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return removeAdminProductMediaCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      validation.data,
    );
  }
  async getPublishedProductMedia(
    input: import("@freshmarkets/contracts").PublishedProductMediaRequest,
  ) {
    return getPublishedProductMedia(this.env.DB, this.env.PRODUCT_MEDIA, input);
  }
  async getAdminProductMediaContent(
    input: import("@freshmarkets/contracts").AdminProductMediaContentRequest,
  ) {
    const validation = catalogProductMediaContentSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminProductMediaContentQuery(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        bucket: this.env.PRODUCT_MEDIA,
      },
      validation.data,
    );
  }
  async createAdminSku(input: import("@freshmarkets/contracts").AdminSkuCreateRequest) {
    const validation = catalogSkuCreateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminSkuCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateAdminSku(input: import("@freshmarkets/contracts").AdminSkuUpdateRequest) {
    const validation = catalogSkuUpdateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminSkuCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminSkuAvailability(
    input: import("@freshmarkets/contracts").AdminSkuAvailabilityRequest,
  ) {
    const validation = catalogSkuAvailabilitySchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminSkuAvailabilityCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async setAdminSkuPrice(input: import("@freshmarkets/contracts").AdminSkuPriceRequest) {
    const validation = catalogSkuPriceSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminSkuPriceCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminSkuPrices(input: import("@freshmarkets/contracts").AdminSkuPricesRequest) {
    return getAdminSkuPricesQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminInventory(input: import("@freshmarkets/contracts").AdminInventoryListRequest) {
    const validation = inventoryListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminInventoryQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminInventoryLedger(
    input: import("@freshmarkets/contracts").AdminInventoryLedgerRequest,
  ) {
    const validation = inventoryLedgerSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminInventoryLedgerQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getGlobalCommerceConfiguration(
    input: import("@freshmarkets/contracts").AuthenticatedRequest,
  ) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminGlobalCommerceConfiguration(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminServiceability(
    input: import("@freshmarkets/contracts").AdminServiceabilityRequest,
  ) {
    return getAdminServiceability(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async publishAdminServiceArea(
    input: import("@freshmarkets/contracts").PublishAdminServiceAreaRequest,
  ) {
    return publishAdminServiceArea(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async previewAdminServiceability(
    input: import("@freshmarkets/contracts").PreviewAdminServiceabilityRequest,
  ) {
    return previewAdminServiceability(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminLocations(input: import("@freshmarkets/contracts").AdminLocationsRequest) {
    return listAdminLocations(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminDeliveryCycles(
    input: import("@freshmarkets/contracts").AuthenticatedRequest & { cursor?: string },
  ) {
    return listAdminDeliveryCycles(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminCycleDestinations(
    input: import("@freshmarkets/contracts").AuthenticatedRequest & {
      marketId: string;
      cursor?: string;
    },
  ) {
    return listAdminCycleDestinations(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async saveAdminDeliveryCycleDraft(
    input: import("@freshmarkets/contracts").SaveAdminDeliveryCycleRequest,
  ) {
    return saveAdminDeliveryCycleDraft(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async scheduleAdminDeliveryCycle(
    input: import("@freshmarkets/contracts").ScheduleAdminDeliveryCycleRequest,
  ) {
    return scheduleAdminDeliveryCycle(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async cancelAdminDeliveryCycle(
    input: import("@freshmarkets/contracts").CancelAdminDeliveryCycleRequest,
  ) {
    return cancelAdminDeliveryCycle(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async createAdminLocation(input: import("@freshmarkets/contracts").CreateAdminLocationRequest) {
    return createAdminLocation(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        geocoder: this.createGeocoderPort(),
      },
      input,
    );
  }
  async getAdminLocationSchedule(
    input: import("@freshmarkets/contracts").AuthenticatedRequest & { locationId: string },
  ) {
    return getAdminLocationSchedule(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async getAdminLocationFulfillment(
    input: import("@freshmarkets/contracts").AuthenticatedRequest & { locationId: string },
  ) {
    return getAdminLocationFulfillment(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async configureAdminLocationFulfillment(
    input: import("@freshmarkets/contracts").ConfigureAdminLocationFulfillmentRequest,
  ) {
    return configureAdminLocationFulfillment(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async saveAdminLocationSchedule(
    input: import("@freshmarkets/contracts").SaveAdminLocationScheduleRequest,
  ) {
    return saveAdminLocationSchedule(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async updateAdminLocation(input: import("@freshmarkets/contracts").UpdateAdminLocationRequest) {
    return updateAdminLocation(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        geocoder: this.createGeocoderPort(),
      },
      input,
    );
  }
  async transitionAdminLocation(
    input: import("@freshmarkets/contracts").TransitionAdminLocationRequest,
  ) {
    return transitionAdminLocation(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async pauseSelling(input: import("@freshmarkets/contracts").PauseSellingRequest) {
    const validation = commerceTransitionSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return pauseAdminSelling(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async activateGlobalMode(
    input: import("@freshmarkets/contracts").ActivateGlobalFulfillmentModeRequest,
  ) {
    const validation = activateGlobalModeSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return activateAdminGlobalMode(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async openSelling(input: import("@freshmarkets/contracts").OpenSellingRequest) {
    const validation = commerceTransitionSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return openAdminSelling(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async aggregateAdminProcurementDemand(
    input: import("@freshmarkets/contracts").AggregateAdminProcurementDemandRequest,
  ) {
    const validation = adminProcurementAggregateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return aggregateAdminProcurementDemand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  getAdminScheduledWeek(input: import("@freshmarkets/contracts").ScheduledWeekRequest) {
    return getAdminScheduledWeek(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  recordScheduledCountedReceipt(
    input: import("@freshmarkets/contracts").RecordScheduledCountedReceiptRequest,
  ) {
    return recordScheduledCountedReceipt(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  releaseScheduledSurplus(input: import("@freshmarkets/contracts").ReleaseScheduledSurplusRequest) {
    return releaseScheduledSurplus(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async confirmAdminProcurementPurchase(
    input: import("@freshmarkets/contracts").ConfirmAdminProcurementPurchaseRequest,
  ) {
    const validation = adminProcurementAggregateSchema
      .extend({
        reason: validationSchema.string().trim().min(1).max(500),
        expectedQuantityBase: validationSchema.number().int().safe().positive(),
        expectedQuantitySellable: validationSchema.number().int().safe().positive(),
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return confirmAdminProcurementPurchase(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async startAdminReceiving(input: import("@freshmarkets/contracts").StartAdminReceivingRequest) {
    const validation = adminReceivingStartSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return startAdminReceiving(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async recordAdminReceivedLine(
    input: import("@freshmarkets/contracts").RecordAdminReceivedLineRequest,
  ) {
    const validation = adminReceivingLineSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return recordAdminReceivedLine(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async completeAdminReceiving(
    input: import("@freshmarkets/contracts").CompleteAdminReceivingRequest,
  ) {
    const validation = adminReceivingCompleteSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return completeAdminReceiving(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async advanceAdminFulfillment(
    input: import("@freshmarkets/contracts").AdvanceAdminFulfillmentRequest,
  ) {
    const validation = adminFulfillmentAdvanceSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const result = await advanceAdminFulfillment(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
    if (result.ok && (input.action === "START_PACKING" || input.action === "MARK_PACKED"))
      await bookAutomaticInstantDeliveries(
        this.env.DB,
        () => this.rpcContext.deliveryProviders(),
        this.context.now(),
        input.orderId,
      );
    return result;
  }
  async resolveAdminOperationalException(
    input: import("@freshmarkets/contracts").ResolveAdminOperationalExceptionRequest,
  ) {
    const validation = adminOperationalExceptionResolveSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return resolveAdminOperationalException(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listProcurementRequirements(
    input: import("@freshmarkets/contracts").AdminProcurementRequirementsRequest,
  ) {
    const validation = adminOperationsCycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminProcurementRequirements(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listReceivingSessions(
    input: import("@freshmarkets/contracts").AdminReceivingSessionsRequest,
  ) {
    const validation = adminOperationsCycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminReceivingSessions(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listFulfillmentQueue(
    input: import("@freshmarkets/contracts").AdminFulfillmentQueueRequest,
  ) {
    const validation = adminOperationsCycleSchema
      .extend({ orderId: validationSchema.string().trim().min(1).max(200).optional() })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminFulfillmentQueue(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listDeliveryOperations(
    input: import("@freshmarkets/contracts").AdminDeliveryOperationsRequest,
  ) {
    const validation = adminOperationsCycleSchema
      .extend({ orderId: validationSchema.string().trim().min(1).max(200).optional() })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminDeliveryOperations(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getLocationDeliveryProfile(
    input: import("@freshmarkets/contracts").AdminOperationsLocationRequest,
  ) {
    const validation = adminOperationsLocationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getLocationDeliveryProfileQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async upsertLocationDeliveryProfile(
    input: import("@freshmarkets/contracts").UpsertLocationDeliveryProfileRequest,
  ) {
    const validation = locationDeliveryProfileSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return upsertLocationDeliveryProfileCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async reviseDeliveryPromise(
    input: import("@freshmarkets/contracts").ReviseDeliveryPromiseRequest,
  ) {
    const validation = adminOperationsLocationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return reviseDeliveryPromise(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      { ...input, ...validation.data },
    );
  }
  async manageManualDelivery(input: import("@freshmarkets/contracts").ManualDeliveryRequest) {
    const validation = adminOperationsLocationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return manageManualDelivery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      { ...input, ...validation.data },
    );
  }
  async requestExternalDelivery(
    input: import("@freshmarkets/contracts").RequestExternalDeliveryRequest,
  ) {
    const validation = requestExternalDeliverySchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    let providers: ReturnType<typeof this.rpcContext.deliveryProviders>;
    let configuredServiceType: string | undefined;
    try {
      providers = this.rpcContext.deliveryProviders();
      configuredServiceType = configuredInstantDeliveryPartners(this.env).find(
        (partner) => partner.providerCode === validation.data.providerCode,
      )?.serviceType;
    } catch {
      return fail(
        "CONFIGURATION_ERROR",
        "External delivery providers are not configured",
        input.requestId,
      );
    }
    const provider = providers.get(validation.data.providerCode);
    if (!provider || !configuredServiceType)
      return fail("CONFIGURATION_ERROR", "Lalamove delivery is not configured", input.requestId);
    return requestExternalDeliveryCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        provider,
        configuredServiceType,
        now: () => this.context.now(),
      },
      validation.data,
    );
  }
  async refreshExternalDelivery(
    input: import("@freshmarkets/contracts").RefreshExternalDeliveryRequest,
  ) {
    const validation = externalDeliveryMutationSchema
      .extend({
        providerDeliveryId: validationSchema.string().trim().min(1).max(200).optional(),
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    try {
      const provider = this.rpcContext.deliveryProviders().get("lalamove");
      if (!provider) throw new Error("unavailable");
      return refreshExternalDeliveryCommand(
        {
          auth: createAuth(this.env as Env & AuthEnvironment),
          db: this.env.DB,
          provider,
          now: () => this.context.now(),
        },
        validation.data,
      );
    } catch {
      return fail("CONFIGURATION_ERROR", "Lalamove delivery is not configured", input.requestId);
    }
  }
  async cancelExternalDelivery(
    input: import("@freshmarkets/contracts").ExternalDeliveryMutationRequest,
  ) {
    const validation = externalDeliveryMutationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    try {
      const provider = this.rpcContext.deliveryProviders().get("lalamove");
      if (!provider) throw new Error("unavailable");
      return cancelExternalDeliveryCommand(
        {
          auth: createAuth(this.env as Env & AuthEnvironment),
          db: this.env.DB,
          provider,
          now: () => this.context.now(),
        },
        validation.data,
      );
    } catch {
      return fail("CONFIGURATION_ERROR", "Lalamove delivery is not configured", input.requestId);
    }
  }
  async listOperationalExceptions(
    input: import("@freshmarkets/contracts").AdminOperationalExceptionsRequest,
  ) {
    const validation = adminOperationalExceptionsSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminOperationalExceptions(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminOrders(input: import("@freshmarkets/contracts").AdminOrderListRequest) {
    const validation = orderListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminOrdersQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminOrder(input: import("@freshmarkets/contracts").AdminOrderDetailRequest) {
    const validation = orderDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminOrderQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async cancelAdminOrder(input: import("@freshmarkets/contracts").AdminOrderCancelRequest) {
    const validation = orderCancelSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return cancelAdminOrderCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        payments: buildProviderRegistry(this.runtimeConfiguration()),
      },
      validation.data,
    );
  }
  async listAdminPayments(input: import("@freshmarkets/contracts").AdminPaymentListRequest) {
    const validation = paymentListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminPaymentsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminPaymentOverview(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminPaymentOverviewQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminPayment(input: import("@freshmarkets/contracts").AdminPaymentDetailRequest) {
    const validation = paymentDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminPaymentQuery(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        payments: buildProviderRegistry(this.runtimeConfiguration()),
      },
      validation.data,
    );
  }
  async retryAdminPaymentReaction(
    input: import("@freshmarkets/contracts").AdminPaymentReactionRetryRequest,
  ) {
    const parsed = authenticatedRequestSchema
      .extend({
        caseId: validationSchema.string().trim().min(1).max(200),
        expectedPaymentVersion: validationSchema.number().int().safe().positive(),
        expectedVersion: validationSchema.number().int().safe().positive(),
        reason: validationSchema.string().trim().min(1).max(500),
        idempotencyKey: validationSchema.string().trim().min(1).max(200),
      })
      .safeParse(input);
    if (!parsed.success)
      return fail("VALIDATION_FAILED", validationMessage(parsed.error), input.requestId);
    return retryAdminPaymentReactionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      parsed.data,
    );
  }
  async retryAdminProviderEvent(
    input: import("@freshmarkets/contracts").AdminProviderEventRetryRequest,
  ) {
    const parsed = authenticatedRequestSchema
      .extend({
        caseId: validationSchema.string().trim().min(1).max(200),
        expectedVersion: validationSchema.number().int().safe().positive(),
        reason: validationSchema.string().trim().min(1).max(500),
        idempotencyKey: validationSchema.string().trim().min(1).max(200),
      })
      .safeParse(input);
    if (!parsed.success)
      return fail("VALIDATION_FAILED", validationMessage(parsed.error), input.requestId);
    return retryAdminProviderEventCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      parsed.data,
    );
  }
  async recheckAdminPayment(input: import("@freshmarkets/contracts").AdminPaymentRecheckRequest) {
    const parsed = authenticatedRequestSchema
      .extend({
        paymentIntentId: validationSchema.string().trim().min(1).max(200),
        expectedVersion: validationSchema.number().int().safe().positive(),
        expectedRecoveryVersion: validationSchema.number().int().safe().nonnegative(),
        reason: validationSchema.string().trim().min(1).max(500),
        idempotencyKey: validationSchema.string().trim().min(1).max(200),
      })
      .safeParse(input);
    if (!parsed.success)
      return fail("VALIDATION_FAILED", validationMessage(parsed.error), input.requestId);
    return recheckAdminPaymentCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      parsed.data,
    );
  }
  async recheckAdminRefund(input: import("@freshmarkets/contracts").AdminRefundRecheckRequest) {
    const parsed = refundRecheckSchema.safeParse(input);
    if (!parsed.success)
      return fail("VALIDATION_FAILED", validationMessage(parsed.error), input.requestId);
    return recheckAdminRefundCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      parsed.data,
    );
  }
  async requestAdminRefund(input: import("@freshmarkets/contracts").AdminRefundRequest) {
    const validation = refundRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return requestAdminRefundCommand(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        payments: buildProviderRegistry(this.runtimeConfiguration()),
      },
      validation.data,
    );
  }
  async listAdminReconciliationCases(
    input: import("@freshmarkets/contracts").AdminReconciliationListRequest,
  ) {
    const validation = reconciliationListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminReconciliationCasesQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async resolveAdminReconciliationCase(
    input: import("@freshmarkets/contracts").AdminReconciliationResolveRequest,
  ) {
    const validation = reconciliationResolveSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return resolveAdminReconciliationCaseCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getMembershipPriceConfiguration(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getMembershipPriceConfigurationQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async updateMembershipPriceConfiguration(
    input: import("@freshmarkets/contracts").UpdateMembershipPriceConfigurationRequest,
  ) {
    const validation = membershipPriceConfigurationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return fail("ILLEGAL_TRANSITION", "Membership pricing is no longer available", input.requestId);
  }
  async listAdminMemberships(input: import("@freshmarkets/contracts").AdminMembershipListRequest) {
    const validation = membershipListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminMembershipsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminMembership(input: import("@freshmarkets/contracts").AdminMembershipDetailRequest) {
    const validation = membershipDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminMembershipQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async cancelAdminMembership(
    input: import("@freshmarkets/contracts").AdminMembershipLifecycleRequest,
  ) {
    const validation = membershipLifecycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeAdminMembershipCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async listAdminOrderIssues(input: import("@freshmarkets/contracts").AdminOrderIssueListRequest) {
    const validation = issueListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminOrderIssuesQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async getAdminOrderIssue(input: import("@freshmarkets/contracts").AdminOrderIssueDetailRequest) {
    const validation = issueDetailSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminOrderIssueQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async applyAdminOrderIssueAction(
    input: import("@freshmarkets/contracts").AdminOrderIssueActionRequest,
  ) {
    const validation = issueActionSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return applyAdminOrderIssueActionCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async resolveServiceability(input: import("@freshmarkets/contracts").ServiceabilityRequest) {
    const validation = serviceabilityRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return resolveServiceability(drizzle(this.env.DB), input);
  }
  async searchAddressCandidates(input: import("@freshmarkets/contracts").AddressSearchRequest) {
    const validation = addressSearchRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const startedAt = Date.now();
    try {
      const candidates = await this.createGeocoderPort().search(validation.data);
      log("info", "geocoder.search", {
        requestId: input.requestId,
        operation: "forward_search",
        durationMs: Date.now() - startedAt,
        resultCategory: candidates.length === 0 ? "empty" : "success",
      });
      return { ok: true as const, value: candidates, requestId: input.requestId };
    } catch (error) {
      if (!(error instanceof GeocoderError)) throw error;
      log("warn", "geocoder.search", {
        requestId: input.requestId,
        operation: "forward_search",
        durationMs: Date.now() - startedAt,
        resultCategory: "failure",
        errorCode: error.code,
      });
      return fail(error.code, "Address search is temporarily unavailable", input.requestId);
    }
  }
  async reverseAddressCandidate(input: import("@freshmarkets/contracts").AddressReverseRequest) {
    const validation = addressReverseRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const startedAt = Date.now();
    try {
      const candidate = await this.createGeocoderPort().reverseTemporary(validation.data);
      log("info", "geocoder.reverse", {
        requestId: input.requestId,
        operation: "temporary_reverse",
        durationMs: Date.now() - startedAt,
        resultCategory: "success",
      });
      return { ok: true as const, value: candidate, requestId: input.requestId };
    } catch (error) {
      if (!(error instanceof GeocoderError)) throw error;
      log("warn", "geocoder.reverse", {
        requestId: input.requestId,
        operation: "temporary_reverse",
        durationMs: Date.now() - startedAt,
        resultCategory: "failure",
        errorCode: error.code,
      });
      return fail(error.code, "Address details are temporarily unavailable", input.requestId);
    }
  }
  async confirmBrowsingLocation(input: import("@freshmarkets/contracts").AddressReverseRequest) {
    const validation = addressReverseRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return confirmBrowsingLocation(
      { db: this.env.DB, geocoder: this.createGeocoderPort() },
      validation.data,
    );
  }
  async searchCatalog(input: import("@freshmarkets/contracts").CatalogSearchRequest) {
    return this.catalogRpc.searchCatalog(input);
  }
  async getMarketplaceHome(input: import("@freshmarkets/contracts").MarketplaceHomeRequest) {
    return this.catalogRpc.getMarketplaceHome(input);
  }
  async getCatalogProduct(input: import("@freshmarkets/contracts").CatalogProductRequest) {
    return this.catalogRpc.getCatalogProduct(input);
  }
  async listCategories(input: RequestMeta) {
    return this.catalogRpc.listCategories(input);
  }

  async createCustomerAddress(
    input: import("@freshmarkets/contracts").CreateCustomerAddressRequest,
  ) {
    const validation = addressRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    try {
      return await createCustomerAddress(this.env.DB, this.createGeocoderPort(), {
        ...input,
        customerId: customer.value.customerId,
      });
    } catch (error) {
      if (error instanceof GeocoderError)
        return fail(error.code, "Address confirmation could not be finalized", input.requestId);
      throw error;
    }
  }

  async listCustomerAddresses(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return listCustomerAddresses(this.env.DB, {
      customerId: customer.value.customerId,
      requestId: input.requestId,
    });
  }

  async updateCustomerAddress(
    input: import("@freshmarkets/contracts").UpdateCustomerAddressRequest,
  ) {
    const validation = addressUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    try {
      return await updateCustomerAddress(this.env.DB, this.createGeocoderPort(), {
        ...input,
        customerId: customer.value.customerId,
      });
    } catch (error) {
      if (error instanceof GeocoderError)
        return fail(error.code, "Address confirmation could not be finalized", input.requestId);
      throw error;
    }
  }

  async startTrial(input: import("@freshmarkets/contracts").StartTrialRequest) {
    return this.membershipRpc.startTrial(input);
  }
  async getMembershipExperience(input: AuthenticatedRequest) {
    return this.membershipRpc.getMembershipExperience(input);
  }
  async getSubscriptionSummary(input: AuthenticatedRequest) {
    return this.membershipRpc.getSubscriptionSummary(input);
  }
  async getOffer(input: AuthenticatedRequest) {
    return this.membershipRpc.getOffer(input);
  }
  async beginPaidEnrollment(input: import("@freshmarkets/contracts").BeginPaidEnrollmentRequest) {
    return this.membershipRpc.beginPaidEnrollment(input);
  }
  async cancelSubscription(input: import("@freshmarkets/contracts").CancelSubscriptionRequest) {
    return this.membershipRpc.cancelSubscription(input);
  }
  async beginRecurringAuthorization(
    input: import("@freshmarkets/contracts").BeginRecurringAuthorizationRequest,
  ) {
    return this.paymentsRpc.beginRecurringAuthorization(input);
  }
  async completeRecurringAuthorization(
    input: import("@freshmarkets/contracts").CompleteRecurringAuthorizationRequest,
  ) {
    return this.paymentsRpc.completeRecurringAuthorization(input);
  }
  async getSubscriptionEligibility(
    input: import("@freshmarkets/contracts").SubscriptionEligibilityRequest,
  ) {
    return this.membershipRpc.getSubscriptionEligibility(input);
  }
  async listDeliveryCycles(input: import("@freshmarkets/contracts").DeliveryCycleRequest) {
    return this.checkoutRpc.listDeliveryCycles(input);
  }

  async getCart(input: AuthenticatedRequest) {
    return this.checkoutRpc.getCart(input);
  }
  async selectCartLocation(input: import("@freshmarkets/contracts").SelectCartLocationRequest) {
    return this.checkoutRpc.selectCartLocation(input);
  }
  async mergeGuestCart(input: import("@freshmarkets/contracts").MergeGuestCartRequest) {
    return this.checkoutRpc.mergeGuestCart(input);
  }
  async setCartItem(input: import("@freshmarkets/contracts").SetCartItemRequest) {
    return this.checkoutRpc.setCartItem(input);
  }

  async evaluateCheckout(input: import("@freshmarkets/contracts").CheckoutEligibilityRequest) {
    return this.checkoutRpc.evaluateCheckout(input);
  }

  async createCheckoutQuote(input: import("@freshmarkets/contracts").CheckoutQuoteCommandRequest) {
    return this.checkoutRpc.createCheckoutQuote(input);
  }

  async listFulfillmentOptions(input: import("@freshmarkets/contracts").FulfillmentOptionsRequest) {
    return this.checkoutRpc.listFulfillmentOptions(input);
  }

  async refreshCheckoutQuote(input: import("@freshmarkets/contracts").CheckoutQuoteRefreshRequest) {
    return this.checkoutRpc.refreshCheckoutQuote(input);
  }

  async abandonCheckoutAttempt(
    input: import("@freshmarkets/contracts").AbandonCheckoutAttemptRequest,
  ) {
    return this.checkoutRpc.abandonCheckoutAttempt(input);
  }

  async createPaymentIntent(input: import("@freshmarkets/contracts").PaymentIntentCommandRequest) {
    return this.paymentsRpc.createPaymentIntent(input);
  }

  async listCustomerOrders(input: import("@freshmarkets/contracts").ListCustomerOrdersRequest) {
    return this.ordersRpc.listCustomerOrders(input);
  }

  async getCustomerOrderDetail(
    input: import("@freshmarkets/contracts").CustomerOrderDetailRequest,
  ) {
    return this.ordersRpc.getCustomerOrderDetail(input);
  }

  async getProvisionalTransactionSummary(
    input: import("@freshmarkets/contracts").ProvisionalTransactionSummaryRequest,
  ) {
    return this.ordersRpc.getProvisionalTransactionSummary(input);
  }

  async cancelCustomerOrder(input: import("@freshmarkets/contracts").CancelCustomerOrderRequest) {
    return this.ordersRpc.cancelCustomerOrder(input);
  }

  async reorderOrder(input: import("@freshmarkets/contracts").ReorderOrderRequest) {
    return this.ordersRpc.reorderOrder(input);
  }

  async listCustomerOrderIssues(
    input: import("@freshmarkets/contracts").ListCustomerOrderIssuesRequest,
  ) {
    return this.ordersRpc.listCustomerOrderIssues(input);
  }

  async submitCustomerOrderIssue(
    input: import("@freshmarkets/contracts").SubmitCustomerOrderIssueRequest,
  ) {
    return this.ordersRpc.submitCustomerOrderIssue(input);
  }

  async createOrderAmendment(input: import("@freshmarkets/contracts").CreateOrderAmendmentRequest) {
    return this.ordersRpc.createOrderAmendment(input);
  }

  async listOrderAdditionOptions(
    input: import("@freshmarkets/contracts").OrderAdditionOptionsRequest,
  ) {
    return this.ordersRpc.listOrderAdditionOptions(input);
  }

  async createAmendmentPaymentIntent(
    input: import("@freshmarkets/contracts").AmendmentPaymentIntentRequest,
  ) {
    return this.paymentsRpc.createAmendmentPaymentIntent(input);
  }
  sortInventoryStock(request: import("@freshmarkets/contracts").SortInventoryStockRequest) {
    return this.inventoryTransfersRpc.sortInventoryStock(request);
  }
  async resolveInventoryTransfer(
    input: import("@freshmarkets/contracts").ResolveInventoryTransferRequest,
  ) {
    return this.inventoryTransfersRpc.resolveInventoryTransfer(input);
  }
  async listInventoryDistribution(
    input: import("@freshmarkets/contracts").InventoryDistributionRequest,
  ) {
    return this.inventoryTransfersRpc.listInventoryDistribution(input);
  }
  async listInventoryTransfers(
    input: import("@freshmarkets/contracts").InventoryTransferListRequest,
  ) {
    return this.inventoryTransfersRpc.listInventoryTransfers(input);
  }

  async getInventoryTransfer(
    input: import("@freshmarkets/contracts").InventoryTransferReadRequest,
  ) {
    return this.inventoryTransfersRpc.getInventoryTransfer(input);
  }

  async getInventoryTransferOptions(
    input: import("@freshmarkets/contracts").InventoryTransferOptionsRequest,
  ) {
    return this.inventoryTransfersRpc.getInventoryTransferOptions(input);
  }

  async createInventoryTransfer(
    input: import("@freshmarkets/contracts").CreateInventoryTransferRequest,
  ) {
    return this.inventoryTransfersRpc.createInventoryTransfer(input);
  }

  async dispatchInventoryTransfer(
    input: import("@freshmarkets/contracts").InventoryTransferCommandRequest,
  ) {
    return this.inventoryTransfersRpc.dispatchInventoryTransfer(input);
  }

  async receiveInventoryTransfer(
    input: import("@freshmarkets/contracts").ReceiveInventoryTransferRequest,
  ) {
    return this.inventoryTransfersRpc.receiveInventoryTransfer(input);
  }

  async cancelInventoryTransfer(
    input: import("@freshmarkets/contracts").InventoryTransferCommandRequest,
  ) {
    return this.inventoryTransfersRpc.cancelInventoryTransfer(input);
  }

  async adjustInventory(input: import("@freshmarkets/contracts").InventoryAdjustmentRequest) {
    return this.operationsRpc.adjustInventory(input);
  }
  async createProcurementRequirement(
    input: import("@freshmarkets/contracts").ProcurementCommandRequest,
  ) {
    return this.operationsRpc.createProcurementRequirement(input);
  }
  async receiveProcurement(input: import("@freshmarkets/contracts").ReceivingCommandRequest) {
    return this.operationsRpc.receiveProcurement(input);
  }
  async advanceFulfillment(input: import("@freshmarkets/contracts").FulfillmentCommandRequest) {
    return this.operationsRpc.advanceFulfillment(input);
  }
  /**
   * Time-driven dispatch only: resolves the fired cron expression through the
   * scheduling registry to idempotent bounded-context commands. No business
   * policy lives here.
   */
  async scheduled(controller: { readonly cron: string }): Promise<void> {
    await runScheduledJobs(this.env, controller.cron, systemClock.now().getTime());
  }

  /** Queue delivery is per-message isolated; domain state remains D1-owned. */
  async queue(batch: MessageBatch<NotificationQueueMessage>): Promise<void> {
    await consumeNotificationBatch(
      this.env.DB,
      createCloudflareEmailDeliveryPort(this.env),
      batch,
      systemClock.now().getTime(),
      this.rpcContext.runtimeConfiguration().auth.baseUrl,
    );
  }

  /**
   * Recent scheduled-job runs for operational visibility. Scheduler telemetry
   * is platform-wide (not location-scoped); any operational manage capability
   * grants visibility, mirroring the operations board's capability set.
   */
  async adminScheduledJobRuns(
    input: import("@freshmarkets/contracts").AdminScheduledJobRunsRequest,
  ) {
    const session = await this.context.session(input);
    if (!session) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const OPERATIONAL_CAPABILITIES = [
      "inventory.adjust",
      "procurement.manage",
      "fulfillment.manage",
      "delivery.manage",
    ] as const satisfies readonly import("@freshmarkets/contracts").Capability[];
    let authorized = false;
    for (const capability of OPERATIONAL_CAPABILITIES) {
      if (await this.context.requireCapability(input, capability)) {
        authorized = true;
        break;
      }
    }
    if (!authorized)
      return fail("FORBIDDEN", "An operational capability is required", input.requestId);
    return listRecentScheduledJobRuns(this.env.DB, input);
  }
}

export default CoreEntrypoint;
