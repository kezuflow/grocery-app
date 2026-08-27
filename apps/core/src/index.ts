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
import { CoreContext } from "./entrypoint/context";
import { buildRouteDistancePort } from "./geography/infrastructure/runtime-route-distance";

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
      input,
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
      input,
    );
  }
  async listAdminAuditEvents(input: import("@freshmarkets/contracts").AdminAuditListRequest) {
    const validation = adminAuditListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminAuditEventsQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async getAdminAuditEvent(input: import("@freshmarkets/contracts").AdminAuditDetailRequest) {
    const validation = adminAuditDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminAuditEventQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async listAdminStaff(input: import("@freshmarkets/contracts").AdminStaffListRequest) {
    const validation = staffListRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return listAdminStaffQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async getAdminStaff(input: import("@freshmarkets/contracts").AdminStaffDetailRequest) {
    const validation = staffDetailRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return getAdminStaffQuery(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
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
      input,
    );
  }
  async inviteAdminStaff(input: import("@freshmarkets/contracts").AdminStaffInviteRequest) {
    const validation = staffInviteRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return inviteAdminStaffCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
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
      input,
    );
  }
  async updateAdminStaff(input: import("@freshmarkets/contracts").AdminStaffUpdateRequest) {
    const validation = staffUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return updateAdminStaffCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
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
      input,
    );
  }
  async setAdminStaffRoles(input: import("@freshmarkets/contracts").AdminStaffRolesRequest) {
    const validation = staffRolesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminStaffRolesCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
    );
  }
  async setAdminStaffScopes(input: import("@freshmarkets/contracts").AdminStaffScopesRequest) {
    const validation = staffScopesRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return setAdminStaffScopesCommand(
      { auth: createAuth(this.env as Env & AuthEnvironment), db: this.env.DB },
      input,
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
      input,
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
          items: (await listDeliveryDispatch(this.env.DB, { locationId })).map((item) => ({
            ...item,
            allowedActions: allowedDeliveryActions(item.status, item.riderAuthUserId !== null),
          })),
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
