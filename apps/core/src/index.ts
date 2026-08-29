import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type AppErrorCode,
  CONTRACT_VERSION,
  type AuthContextRequest,
  type AuthRequest,
  type AuthResponse,
  type AuthenticatedRequest,
  type CoreHealthResponse,
  type RequestMeta,
  adminCapabilityCodes,
  analyticsDimensionKeys,
  analyticsMetricCategories,
  metricDefinitionStatuses,
} from "@freshmarkets/contracts";
import { runtimeEnvironment } from "@freshmarkets/config";
import { idempotencyKeySchema, z as validationSchema } from "@freshmarkets/validation";
import {
  createCheckoutQuote as createCheckoutQuoteCommand,
  refreshCustomerCheckoutQuote,
} from "./checkout/application/create-checkout-quote";
import {
  buildProviderRegistry,
  selectedPaymentProviderCode,
} from "./payments/infrastructure/providers/runtime-providers";
import { runScheduledJobs } from "./scheduling/run-scheduled-jobs";
import { listRecentScheduledJobRuns } from "./scheduling/list-recent-runs";
import { beginRecurringAuthorization as beginRecurringAuthorizationCommand } from "./payments/application/begin-recurring-authorization";
import { completeRecurringAuthorization as completeRecurringAuthorizationCommand } from "./payments/application/complete-recurring-authorization";
import { systemClock } from "@freshmarkets/domain-shared";
import {
  addressRequestSchema,
  addressUpdateRequestSchema,
  authenticatedRequestSchema,
  catalogProductRequestSchema,
  catalogSearchRequestSchema,
  createCheckoutQuoteSchema,
  createPaymentIntentSchema,
  marketplaceHomeRequestSchema,
  refreshCheckoutQuoteSchema,
  checkoutRequestSchema,
  deliveryCommandSchema,
  fulfillmentCommandSchema,
  inventoryAdjustmentSchema,
  procurementCommandSchema,
  receivingCommandSchema,
  serviceabilityRequestSchema,
  setCartItemRequestSchema,
  validationMessage,
} from "./validation";
import { createCheckoutPaymentIntent } from "./payments/application/create-checkout-payment-intent";
import { adjustInventory as adjustInventoryCommand } from "./inventory/application/adjust-inventory";
import { handleProviderWebhook } from "./payments/http/provider-webhook";
import { startPromotionalTrial as startPromotionalTrialCommand } from "./membership/application/start-promotional-trial";
import { getSubscriptionEligibility } from "./membership/application/subscription-eligibility";
import { drizzle } from "drizzle-orm/d1";
import { log, requestId } from "./observability";
import { applicationContext } from "./auth/authorization";
import { createAuth, type AuthEnvironment } from "./auth/service";
import { iamSchema } from "./iam/schema";
import { resolveServiceability } from "./geography/serviceability";
import { activeMarketCode } from "./geography/market-defaults";
import {
  CatalogValidationError,
  getMarketplaceHome,
  getProduct,
  listCategories,
  searchCatalog,
} from "./catalog/service";
import { listDeliveryCycles as listDeliveryCyclesQuery } from "./commerce/cycle-queries";
import {
  getCart as getCartQuery,
  setCartItem as setCartItemCommand,
} from "./checkout/application/cart";
import { evaluateCheckout as evaluateCheckoutPolicy } from "./checkout/application/evaluate-checkout";
import { listCustomerOrders as listCustomerOrdersQuery } from "./orders/application/list-customer-orders";
import {
  createCustomerAddress,
  listCustomerAddresses,
  updateCustomerAddress,
} from "./customer/addresses";
import { createProcurementRequirement as createProcurementRequirementCommand } from "./procurement/application/create-procurement-requirement";
import { receiveProcurement as receiveProcurementCommand } from "./procurement/application/receive-procurement";
import { advanceFulfillment as advanceFulfillmentCommand } from "./operations/application/advance-fulfillment";
import { advanceDelivery as advanceDeliveryCommand } from "./operations/application/advance-delivery";
import {
  listFulfillmentQueue,
  allowedFulfillmentActions,
} from "./fulfillment/application/list-fulfillment-queue";
import {
  listDeliveryDispatch,
  allowedDeliveryActions,
} from "./delivery/application/list-delivery-dispatch";
import { listRiderJobs } from "./delivery/application/list-rider-jobs";
import { assignRider as assignRiderCommand } from "./delivery/application/assign-rider";
import { listProcurementQueue } from "./procurement/application/list-procurement-queue";
import { listOperationalExceptions } from "./audit/application/list-operational-exceptions";
import {
  getAdminFulfillmentMode,
  listAdminDeliveryOperations,
  listAdminFulfillmentQueue,
  listAdminOperationalExceptions,
  listAdminProcurementRequirements,
  listAdminReceivingSessions,
} from "./admin/application/operations-reads";
import { resolveOperationsAdministrationAccess } from "./admin/application/operations-administration-access";
import { setFulfillmentLocationMode } from "./fulfillment/application/location-mode";
import {
  activateAdminFulfillmentMode,
  aggregateAdminProcurementDemand,
  startAdminReceiving,
  recordAdminReceivedLine,
  completeAdminReceiving,
  advanceAdminFulfillment,
  advanceAdminDelivery,
  resolveAdminOperationalException,
} from "./admin/application/operations-commands";
import { getAdminContext as getAdminContextQuery } from "./admin/application/get-admin-context";
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
} from "./admin/application/product-media";
import {
  listAdminInventory as listAdminInventoryQuery,
  getAdminInventoryLedger as getAdminInventoryLedgerQuery,
} from "./admin/application/catalog-reads";
import {
  listAdminOrders as listAdminOrdersQuery,
  getAdminOrder as getAdminOrderQuery,
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
  resolveAdminReconciliationCase as resolveAdminReconciliationCaseCommand,
  changeAdminMembership as changeAdminMembershipCommand,
  applyAdminOrderIssueAction as applyAdminOrderIssueActionCommand,
} from "./admin/application/finance-commands";
import { CoreContext } from "./entrypoint/context";
import { buildRouteDistancePort } from "./geography/infrastructure/runtime-route-distance";
import { listAnalyticsMetricDefinitions } from "./analytics/application/list-metric-definitions";
import { getAnalyticsOverview } from "./analytics/application/get-analytics-overview";
import { getMetricSeries } from "./analytics/application/get-metric-series";

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

const staffInviteRequestSchema = authenticatedRequestSchema.extend({
  email: emailTextSchema,
  displayName: validationSchema.string().trim().min(1).max(120),
  idempotencyKey: idempotencyKeySchema,
});

const staffInvitationRevokeRequestSchema = authenticatedRequestSchema.extend({
  invitationId: validationSchema.string().trim().min(1).max(200),
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
  expectedVersion: validationSchema.number().int().min(0),
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
  expectedVersion: validationSchema.number().int().min(0),
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

const promotionCreateRequestSchema = authenticatedRequestSchema.extend({
  code: validationSchema
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, "expected UPPER_SNAKE_CASE code"),
  name: validationSchema.string().trim().min(1).max(120),
  description: validationSchema.string().trim().max(300),
  benefitType: validationSchema.enum(["ORDER_FIXED_DISCOUNT", "ORDER_PERCENT_DISCOUNT"]),
  discountMinor: validationSchema.number().int().min(1).optional(),
  percent: validationSchema.number().int().min(1).max(100).optional(),
  minimumMinor: validationSchema.number().int().min(0),
  startsAt: validationSchema.string().trim().min(4).max(40),
  endsAt: validationSchema.string().trim().min(4).max(40).nullable().optional(),
  globalUsageLimit: validationSchema.number().int().min(1).nullable().optional(),
  perCustomerUsageLimit: validationSchema.number().int().min(1).nullable().optional(),
  automatic: validationSchema.boolean().optional(),
  priority: validationSchema.number().int().min(0).max(10000).optional(),
  idempotencyKey: idempotencyKeySchema,
});

const promotionUpdateRequestSchema = authenticatedRequestSchema.extend({
  promotionId: validationSchema.string().trim().min(1).max(200),
  name: validationSchema.string().trim().min(1).max(120),
  description: validationSchema.string().trim().max(300),
  discountMinor: validationSchema.number().int().min(1).optional(),
  percent: validationSchema.number().int().min(1).max(100).optional(),
  minimumMinor: validationSchema.number().int().min(0),
  startsAt: validationSchema.string().trim().min(4).max(40),
  endsAt: validationSchema.string().trim().min(4).max(40).nullable().optional(),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const promotionStatusChangeRequestSchema = authenticatedRequestSchema.extend({
  promotionId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum(["ACTIVATE", "DEACTIVATE", "ARCHIVE"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const promotionPreviewRequestSchema = authenticatedRequestSchema.extend({
  promotionId: validationSchema.string().trim().min(1).max(200),
  subtotalMinor: validationSchema.number().int().min(0),
});

const promotionGrantRequestSchema = authenticatedRequestSchema.extend({
  promotionId: validationSchema.string().trim().min(1).max(200),
  customerId: validationSchema.string().trim().min(1).max(200),
  maxRedemptions: validationSchema.number().int().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
});

const catalogCategoryCreateSchema = authenticatedRequestSchema.extend({
  code: validationSchema
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, "expected UPPER_SNAKE_CASE code"),
  name: validationSchema.string().trim().min(1).max(120),
  slug: validationSchema
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug"),
  sortOrder: validationSchema.number().int().min(0).max(10000).optional(),
  parentCategoryId: validationSchema.string().trim().min(1).max(200).nullable().optional(),
  iconAssetKey: validationSchema
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/)
    .nullable()
    .optional(),
  idempotencyKey: idempotencyKeySchema,
});

const catalogCategoryDetailSchema = authenticatedRequestSchema.extend({
  categoryId: validationSchema.string().trim().min(1).max(200),
});

const catalogCategoryUpdateSchema = catalogCategoryDetailSchema.extend({
  name: validationSchema.string().trim().min(1).max(120),
  slug: validationSchema
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug"),
  parentCategoryId: validationSchema.string().trim().min(1).max(200).nullable(),
  iconAssetKey: validationSchema
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/)
    .nullable(),
  sortOrder: validationSchema.number().int().min(0).max(10000),
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const catalogCategoryStatusSchema = catalogCategoryDetailSchema.extend({
  status: validationSchema.enum(["active", "inactive"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(1),
  idempotencyKey: idempotencyKeySchema,
});

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

const catalogProductListSchema = authenticatedRequestSchema.extend({
  query: validationSchema.string().trim().min(1).max(100).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const catalogProductCustomerDetailSchema = validationSchema.object({
  label: validationSchema.string().trim().min(1).max(80),
  value: validationSchema.string().trim().min(1).max(1000),
  sortOrder: validationSchema.number().int().min(0).max(10000),
});

const catalogProductCreateSchema = authenticatedRequestSchema.extend({
  categoryId: validationSchema.string().trim().min(1).max(200),
  slug: validationSchema
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case slug"),
  name: validationSchema.string().trim().min(1).max(160),
  description: validationSchema.string().trim().max(2000).nullable(),
  customerDetails: validationSchema.array(catalogProductCustomerDetailSchema).max(20),
  inventoryBaseUnitId: validationSchema.string().trim().min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
});

const catalogProductUpdateSchema = catalogProductCreateSchema
  .omit({ inventoryBaseUnitId: true })
  .extend({
    productId: validationSchema.string().trim().min(1).max(200),
    expectedVersion: validationSchema.number().int().min(1),
  });

const catalogProductDetailSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
});

const catalogProductStatusSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
  status: validationSchema.enum(["active", "inactive"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
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

const catalogSkuCreateSchema = authenticatedRequestSchema.extend({
  productId: validationSchema.string().trim().min(1).max(200),
  code: validationSchema.string().trim().min(1).max(80),
  name: validationSchema.string().trim().min(1).max(120),
  sellableUnitId: validationSchema.string().trim().min(1).max(200),
  sellQuantity: validationSchema.number().int().min(1),
  consumptionBaseQuantity: validationSchema.number().int().min(1),
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
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const catalogSkuAvailabilitySchema = authenticatedRequestSchema.extend({
  skuId: validationSchema.string().trim().min(1).max(200),
  locationId: validationSchema.string().trim().min(1).max(200),
  availabilityStatus: validationSchema.enum(["AVAILABLE", "UNAVAILABLE"]),
  sourcingMode: validationSchema.enum(["STOCKED", "PLANNED", "ON_DEMAND", "MIXED"]),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

const catalogSkuPriceSchema = authenticatedRequestSchema.extend({
  skuId: validationSchema.string().trim().min(1).max(200),
  marketId: validationSchema.string().trim().min(1).max(200),
  locationId: validationSchema.string().trim().min(1).max(200).nullable(),
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
const adminOperationalExceptionsSchema = adminOperationsLocationSchema.extend({
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});
const activateFulfillmentModeSchema = adminOperationsLocationSchema.extend({
  fulfillmentMode: validationSchema.enum(["INSTANT", "SCHEDULED"]),
  cadence: validationSchema.enum(["WEEKLY"]).nullable().optional(),
  promiseMinutes: validationSchema.number().int().min(1).nullable().optional(),
  maxConcurrentInstantOrders: validationSchema.number().int().min(1).nullable().optional(),
  expectedVersion: validationSchema.number().int().min(0).nullable(),
  idempotencyKey: idempotencyKeySchema,
});
const adminProcurementAggregateSchema = adminOperationsLocationSchema.extend({
  cycleId: validationSchema.string().trim().min(1).max(200),
  inventoryPoolId: validationSchema.string().trim().min(1).max(200),
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
const adminDeliveryAdvanceSchema = adminOperationsLocationSchema.extend({
  orderId: validationSchema.string().trim().min(1).max(200),
  action: validationSchema.enum([
    "MARK_EN_ROUTE",
    "MARK_ARRIVED",
    "MARK_DELIVERED",
    "MARK_FAILED",
    "SCHEDULE_RETRY",
    "ESCALATE",
    "CANCEL",
  ]),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
  reason: validationSchema.string().trim().min(1).max(500).optional(),
});
const adminOperationalExceptionResolveSchema = adminOperationsLocationSchema.extend({
  kind: validationSchema.enum(["FULFILLMENT_SHORTAGE", "DELIVERY_FAILED"]),
  action: validationSchema.enum(["RETRY_FULFILLMENT", "RETRY_DELIVERY"]),
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

const refundRequestSchema = authenticatedRequestSchema.extend({
  paymentIntentId: validationSchema.string().trim().min(1).max(200),
  amountMinor: validationSchema.number().int().min(1),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const reconciliationListSchema = authenticatedRequestSchema.extend({
  status: validationSchema.enum(["OPEN", "RESOLVED"]).optional(),
  cursor: validationSchema.string().min(1).max(512).optional(),
  limit: validationSchema.number().int().min(1).max(100).optional(),
});

const reconciliationResolveSchema = authenticatedRequestSchema.extend({
  caseId: validationSchema.string().trim().min(1).max(200),
  reason: validationSchema.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});

const membershipListSchema = authenticatedRequestSchema.extend({
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
  action: validationSchema.enum(["CLAIM", "BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"]),
  reason: validationSchema.string().trim().min(1).max(500),
  expectedVersion: validationSchema.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});

export function buildHealthResponse(env: Env): CoreHealthResponse {
  return {
    service: "core",
    status: "ok",
    contractVersion: CONTRACT_VERSION,
    environment: runtimeEnvironment(env.ENVIRONMENT),
    databaseBindingConfigured: Boolean(env.DB),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Worker transport and dependency composition only. Every RPC validates its
 * boundary schema, resolves authentication/authorization through the
 * application context, and delegates to the owning bounded-context module;
 * domain behavior lives beside its context, never here.
 */
export class CoreEntrypoint extends WorkerEntrypoint<Env> {
  private readonly context = new CoreContext(this.env as Env & AuthEnvironment, systemClock);

  async fetch(request: Request): Promise<Response> {
    const id = requestId(request);
    const path = new URL(request.url).pathname;
    if (path === "/health")
      return Response.json(await this.health({ requestId: id }), {
        headers: { "x-request-id": id },
      });
    if (path.startsWith("/webhooks/payments/"))
      return handleProviderWebhook(this.env.DB, buildProviderRegistry(this.env), request);
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
  async auth(input: AuthRequest): Promise<AuthResponse> {
    const request = new Request(input.url, {
      method: input.method,
      headers: new Headers(input.headers),
      body:
        input.body && input.method !== "GET" && input.method !== "HEAD" ? input.body : undefined,
    });
    return serializeAuthResponse(
      await createAuth(this.env as Env & AuthEnvironment).handler(request),
    );
  }
  async getApplicationContext(input: AuthContextRequest) {
    return applicationContext(
      createAuth(this.env as Env & AuthEnvironment),
      drizzle(this.env.DB, { schema: iamSchema }),
      input,
    );
  }
  async getAdminContext(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminContextQuery(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        environment: runtimeEnvironment(this.env.ENVIRONMENT),
      },
      validation.data,
    );
  }
  async listAdminScopes(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminScopesQuery(
      {
        auth: createAuth(this.env as Env & AuthEnvironment),
        db: this.env.DB,
        environment: runtimeEnvironment(this.env.ENVIRONMENT),
      },
      validation.data,
    );
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
    const validation = authenticatedRequestSchema.safeParse(input);
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
    const validation = catalogProductListSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminProductsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async createAdminProduct(input: import("@freshmarkets/contracts").AdminProductCreateRequest) {
    const validation = catalogProductCreateSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return createAdminProductCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
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
  async getFulfillmentMode(
    input: import("@freshmarkets/contracts").AdminOperationsLocationRequest,
  ) {
    const validation = adminOperationsLocationSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminFulfillmentMode(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async activateFulfillmentMode(
    input: import("@freshmarkets/contracts").ActivateFulfillmentModeRequest,
  ) {
    const validation = activateFulfillmentModeSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return activateAdminFulfillmentMode(
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
    return advanceAdminFulfillment(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
  }
  async advanceAdminDelivery(input: import("@freshmarkets/contracts").AdvanceAdminDeliveryRequest) {
    const validation = adminDeliveryAdvanceSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return advanceAdminDelivery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
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
    const validation = adminOperationsCycleSchema.safeParse(input);
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
    const validation = adminOperationsCycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminDeliveryOperations(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
    );
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
        payments: buildProviderRegistry(this.env),
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
  async requestAdminRefund(input: import("@freshmarkets/contracts").AdminRefundRequest) {
    const validation = refundRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return requestAdminRefundCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
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
  async pauseAdminMembership(
    input: import("@freshmarkets/contracts").AdminMembershipLifecycleRequest,
  ) {
    const validation = membershipLifecycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeAdminMembershipCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
      "PAUSE",
    );
  }
  async resumeAdminMembership(
    input: import("@freshmarkets/contracts").AdminMembershipLifecycleRequest,
  ) {
    const validation = membershipLifecycleSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return changeAdminMembershipCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      validation.data,
      "RESUME",
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
      "CANCEL",
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
    return {
      ok: true as const,
      value: await resolveServiceability(drizzle(this.env.DB), input),
      requestId: input.requestId,
    };
  }
  async searchCatalog(input: import("@freshmarkets/contracts").CatalogSearchRequest) {
    const validation = catalogSearchRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    try {
      return {
        ok: true as const,
        value: await searchCatalog(this.env.DB, input),
        requestId: input.requestId,
      };
    } catch (error) {
      if (error instanceof CatalogValidationError)
        return fail("VALIDATION_FAILED", error.message, input.requestId);
      throw error;
    }
  }
  async getMarketplaceHome(input: import("@freshmarkets/contracts").MarketplaceHomeRequest) {
    const validation = marketplaceHomeRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    try {
      return {
        ok: true as const,
        value: await getMarketplaceHome(this.env.DB, input),
        requestId: input.requestId,
      };
    } catch (error) {
      if (error instanceof CatalogValidationError)
        return fail("VALIDATION_FAILED", error.message, input.requestId);
      throw error;
    }
  }
  async getCatalogProduct(input: import("@freshmarkets/contracts").CatalogProductRequest) {
    const validation = catalogProductRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return {
      ok: true as const,
      value: await getProduct(this.env.DB, input.slug, input.locationId),
      requestId: input.requestId,
    };
  }
  async listCategories(input: RequestMeta) {
    return {
      ok: true as const,
      value: await listCategories(this.env.DB),
      requestId: input.requestId,
    };
  }

  async createCustomerAddress(
    input: import("@freshmarkets/contracts").CreateCustomerAddressRequest,
  ) {
    const validation = addressRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return createCustomerAddress(this.env.DB, { ...input, customerId: customer.value.customerId });
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
    return updateCustomerAddress(this.env.DB, { ...input, customerId: customer.value.customerId });
  }

  async startTrial(input: import("@freshmarkets/contracts").StartTrialRequest) {
    const validation = authenticatedRequestSchema
      .extend({ idempotencyKey: idempotencyKeySchema })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return startPromotionalTrialCommand(this.env.DB, {
      customerId: customer.value.customerId,
      idempotencyKey: input.idempotencyKey!,
      requestId: input.requestId,
    });
  }
  async beginRecurringAuthorization(
    input: import("@freshmarkets/contracts").BeginRecurringAuthorizationRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({
        providerCode: validationSchema.string().optional(),
        currency: validationSchema.string().optional(),
        returnUrl: validationSchema.string().min(1),
        idempotencyKey: idempotencyKeySchema,
      })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const registry = buildProviderRegistry(this.env);
    const providerCode = selectedPaymentProviderCode(this.env);
    if (
      !providerCode ||
      (validation.data.providerCode && validation.data.providerCode !== providerCode)
    )
      return fail(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Recurring authorization is unavailable in this environment.",
        input.requestId,
      );
    return beginRecurringAuthorizationCommand(this.env.DB, registry, {
      customerId: customer.value.customerId,
      providerCode,
      currency: validation.data.currency ?? "PHP",
      returnUrl: validation.data.returnUrl,
      idempotencyKey: validation.data.idempotencyKey!,
      requestId: input.requestId,
    });
  }
  async completeRecurringAuthorization(
    input: import("@freshmarkets/contracts").CompleteRecurringAuthorizationRequest,
  ) {
    const validation = authenticatedRequestSchema
      .extend({ authorizationId: validationSchema.string().min(1) })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return completeRecurringAuthorizationCommand(this.env.DB, buildProviderRegistry(this.env), {
      customerId: customer.value.customerId,
      authorizationId: validation.data.authorizationId!,
      requestId: input.requestId,
    });
  }
  async getSubscriptionEligibility(
    input: import("@freshmarkets/contracts").SubscriptionEligibilityRequest,
  ) {
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return getSubscriptionEligibility(this.env.DB, {
      ...input,
      customerId: customer.value.customerId,
    });
  }
  async listDeliveryCycles(input: import("@freshmarkets/contracts").DeliveryCycleRequest) {
    return listDeliveryCyclesQuery(
      this.env.DB,
      { marketCode: input.marketCode, requestId: input.requestId },
      () => activeMarketCode(this.env.DB),
    );
  }

  async getCart(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return getCartQuery(this.env.DB, { ...input, customerId: customer.value.customerId });
  }
  async setCartItem(input: import("@freshmarkets/contracts").SetCartItemRequest) {
    const validation = setCartItemRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return setCartItemCommand(this.env.DB, { ...input, customerId: customer.value.customerId });
  }

  async evaluateCheckout(input: import("@freshmarkets/contracts").CheckoutEligibilityRequest) {
    const validation = checkoutRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return evaluateCheckoutPolicy(this.env.DB, {
      ...input,
      customerId: customer.value.customerId,
    });
  }

  async createCheckoutQuote(input: import("@freshmarkets/contracts").CheckoutQuoteCommandRequest) {
    const validation = createCheckoutQuoteSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return createCheckoutQuoteCommand(
      this.env.DB,
      {
        customerId: customer.value.customerId,
        cartId: input.cartId,
        cartVersion: input.cartVersion,
        addressId: input.addressId,
        deliveryCycleId: input.deliveryCycleId,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
      },
      { routeDistance: buildRouteDistancePort(this.env) },
    );
  }

  async refreshCheckoutQuote(input: import("@freshmarkets/contracts").CheckoutQuoteRefreshRequest) {
    const validation = refreshCheckoutQuoteSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return refreshCustomerCheckoutQuote(this.env.DB, {
      quoteId: input.quoteId,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      customerId: customer.value.customerId,
    });
  }

  async createPaymentIntent(input: import("@freshmarkets/contracts").PaymentIntentCommandRequest) {
    const validation = createPaymentIntentSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const providerCode = selectedPaymentProviderCode(this.env);
    if (!providerCode || (input.providerCode && input.providerCode !== providerCode))
      return fail(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "A payment provider is not configured for this environment.",
        input.requestId,
      );
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return createCheckoutPaymentIntent(
      this.env.DB,
      buildProviderRegistry(this.env),
      providerCode,
      buildRouteDistancePort(this.env),
      {
        ...input,
        customerId: customer.value.customerId,
      },
    );
  }

  async listCustomerOrders(input: AuthenticatedRequest) {
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return listCustomerOrdersQuery(this.env.DB, {
      customerId: customer.value.customerId,
      requestId: input.requestId,
    });
  }
  async adjustInventory(input: import("@freshmarkets/contracts").InventoryAdjustmentRequest) {
    const validation = inventoryAdjustmentSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    if (!(await this.context.requireOperationalAccess(input, "inventory.adjust", input.locationId)))
      return fail(
        "FORBIDDEN",
        "Inventory capability and location scope are required",
        input.requestId,
      );
    const actor = await this.context.session(input);
    if (!actor) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    return adjustInventoryCommand(this.env.DB, {
      requestId: input.requestId,
      actorId: actor.id,
      locationId: input.locationId,
      inventoryPoolId: input.inventoryPoolId,
      deltaBase: input.delta,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
    });
  }
  async createProcurementRequirement(
    input: import("@freshmarkets/contracts").ProcurementCommandRequest,
  ) {
    const validation = procurementCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    if (
      !(await this.context.requireOperationalAccess(input, "procurement.manage", input.locationId))
    )
      return fail(
        "FORBIDDEN",
        "Procurement capability and location scope are required",
        input.requestId,
      );
    return createProcurementRequirementCommand(this.env.DB, input);
  }
  async receiveProcurement(input: import("@freshmarkets/contracts").ReceivingCommandRequest) {
    const validation = receivingCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const actor = await this.context.session(input);
    if (!actor) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    return receiveProcurementCommand(
      this.env.DB,
      { ...input, actorId: actor.id },
      {
        authorize: (locationId) =>
          this.context.requireOperationalAccess(input, "procurement.manage", locationId),
      },
    );
  }
  async advanceFulfillment(input: import("@freshmarkets/contracts").FulfillmentCommandRequest) {
    const validation = fulfillmentCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return advanceFulfillmentCommand(this.env.DB, input, {
      authorize: (locationId) =>
        this.context.requireOperationalAccess(input, "fulfillment.manage", locationId),
    });
  }
  async advanceDelivery(input: import("@freshmarkets/contracts").DeliveryCommandRequest) {
    const validation = deliveryCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return advanceDeliveryCommand(this.env.DB, input, {
      authorize: (job) => this.context.authorizeDeliveryJob(input, job),
    });
  }

  /**
   * Purpose-built operational board: one location-scoped decision surface
   * composed from the fulfillment, delivery, procurement, and exception read
   * models. Sections the actor holds no capability for are reported as
   * denied instead of leaking rows; a requester with no authorized section
   * at all is rejected.
   */
  async adminOperationsBoard(input: import("@freshmarkets/contracts").AdminOperationsBoardRequest) {
    const session = await this.context.session(input);
    if (!session) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const locationId = await this.context.resolveBoardLocation(input.locationId);
    if (!locationId)
      return fail(
        "CONFIGURATION_ERROR",
        "No active fulfillment location is configured",
        input.requestId,
      );
    const sections: Array<{
      name: import("@freshmarkets/contracts").OperationsReadSection;
      capability: import("@freshmarkets/contracts").Capability;
      load: () => Promise<
        | { items: import("@freshmarkets/contracts").AdminOperationsBoardValue["fulfillment"] }
        | { items: import("@freshmarkets/contracts").AdminOperationsBoardValue["delivery"] }
        | { items: import("@freshmarkets/contracts").AdminOperationsBoardValue["procurement"] }
      >;
    }> = [
      {
        name: "fulfillment",
        capability: "fulfillment.manage",
        load: async () => ({
          items: (await listFulfillmentQueue(this.env.DB, { locationId })).map((item) => ({
            ...item,
            allowedActions: allowedFulfillmentActions(item.status),
          })),
        }),
      },
      {
        name: "delivery",
        capability: "delivery.manage",
        load: async () => ({
          items: (await listDeliveryDispatch(this.env.DB, { locationId })).map(
            ({ addressSnapshotJson: _, ...item }) => ({
              ...item,
              allowedActions: allowedDeliveryActions(item.status, item.riderAuthUserId !== null),
            }),
          ),
        }),
      },
      {
        name: "procurement",
        capability: "procurement.manage",
        load: async () => ({ items: await listProcurementQueue(this.env.DB, { locationId }) }),
      },
    ];
    const value: {
      locationId: string;
      fulfillment: import("@freshmarkets/contracts").AdminOperationsBoardValue["fulfillment"];
      delivery: import("@freshmarkets/contracts").AdminOperationsBoardValue["delivery"];
      procurement: import("@freshmarkets/contracts").AdminOperationsBoardValue["procurement"];
      exceptions: import("@freshmarkets/contracts").AdminOperationsBoardValue["exceptions"];
      sectionsDenied: import("@freshmarkets/contracts").OperationsReadSection[];
    } = {
      locationId,
      fulfillment: [],
      delivery: [],
      procurement: [],
      exceptions: [],
      sectionsDenied: [],
    };
    let authorizedSections = 0;
    for (const section of sections) {
      if (!(await this.context.requireOperationalAccess(input, section.capability, locationId))) {
        value.sectionsDenied.push(section.name);
        continue;
      }
      authorizedSections += 1;
      const loaded = (await section.load()) as { items: unknown[] };
      (value[section.name] as unknown[]) = loaded.items;
    }
    if (authorizedSections === 0)
      return fail("FORBIDDEN", "No operational capability for this location", input.requestId);
    if (value.sectionsDenied.length < 3 || authorizedSections > 0)
      value.exceptions = await listOperationalExceptions(this.env.DB, { locationId });
    return { ok: true as const, value, requestId: input.requestId };
  }

  /** Assign an open delivery job to an active staff rider. */
  async assignRider(input: import("@freshmarkets/contracts").AssignRiderRequest) {
    const session = await this.context.session(input);
    if (!session) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    return assignRiderCommand(
      this.env.DB,
      {
        requestId: input.requestId,
        orderId: input.orderId,
        riderAuthUserId: input.riderAuthUserId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      },
      {
        authorize: (locationId) =>
          locationId
            ? this.context.requireOperationalAccess(input, "delivery.manage", locationId)
            : Promise.resolve(false),
      },
    );
  }

  /** The requesting rider's own open delivery jobs. */
  async riderJobs(input: import("@freshmarkets/contracts").AuthenticatedRequest) {
    const session = await this.context.session(input);
    if (!session) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    return {
      ok: true as const,
      value: { jobs: await listRiderJobs(this.env.DB, { riderAuthUserId: session.id }) },
      requestId: input.requestId,
    };
  }

  /**
   * Time-driven dispatch only: resolves the fired cron expression through the
   * scheduling registry to idempotent bounded-context commands. No business
   * policy lives here.
   */
  async scheduled(controller: { readonly cron: string }): Promise<void> {
    await runScheduledJobs(this.env, controller.cron, systemClock.now().getTime());
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

async function serializeAuthResponse(response: Response): Promise<AuthResponse> {
  const headers: Array<readonly [string, string]> = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers.push([key, value]);
  });
  for (const cookie of response.headers.getSetCookie?.() ?? [])
    headers.push(["set-cookie", cookie]);
  return { status: response.status, headers, body: await response.text() };
}
export default CoreEntrypoint;
