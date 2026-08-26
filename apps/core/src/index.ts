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
import { idempotencyKeySchema } from "@freshmarkets/validation";
import {
  createCheckoutQuote as createCheckoutQuoteCommand,
  refreshCustomerCheckoutQuote,
} from "./checkout/application/create-checkout-quote";
import { ProviderRegistry } from "./payments/infrastructure/providers/provider-registry";
import { createPayment as createPaymentIntentCommand } from "./payments/application/create-payment";
import { systemClock } from "@freshmarkets/domain-shared";
import {
  addressRequestSchema,
  addressUpdateRequestSchema,
  adminOrderCommandSchema,
  authenticatedRequestSchema,
  catalogProductRequestSchema,
  catalogSearchRequestSchema,
  createCheckoutQuoteSchema,
  createPaymentIntentSchema,
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
import { isSandboxPaymentEnabled, type PaymentRuntimeEnvironment } from "./payments/sandbox-policy";
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
import { getProduct, listCategories, searchCatalog } from "./catalog/service";
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
import { cancelOrder } from "./orders/application/cancel-order";
import { CoreContext } from "./entrypoint/context";

function fail(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

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
      return handleProviderWebhook(
        this.env.DB,
        new ProviderRegistry((this.env as PaymentRuntimeEnvironment).ENVIRONMENT),
        request,
      );
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
    return {
      ok: true as const,
      value: await searchCatalog(drizzle(this.env.DB), input),
      requestId: input.requestId,
    };
  }
  async getCatalogProduct(input: import("@freshmarkets/contracts").CatalogProductRequest) {
    const validation = catalogProductRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return {
      ok: true as const,
      value: await getProduct(drizzle(this.env.DB), input.slug, input.locationId),
      requestId: input.requestId,
    };
  }
  async listCategories(input: RequestMeta) {
    return {
      ok: true as const,
      value: await listCategories(drizzle(this.env.DB)),
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
    return createCheckoutQuoteCommand(this.env.DB, {
      customerId: customer.value.customerId,
      cartId: input.cartId,
      cartVersion: input.cartVersion,
      addressId: input.addressId,
      deliveryCycleId: input.deliveryCycleId,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });
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
    if (!isSandboxPaymentEnabled(this.env as PaymentRuntimeEnvironment))
      return fail(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "A payment provider is not configured for this environment.",
        input.requestId,
      );
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return createCheckoutPaymentIntent(this.env.DB, this.env as PaymentRuntimeEnvironment, {
      ...input,
      customerId: customer.value.customerId,
    });
  }

  async listCustomerOrders(input: AuthenticatedRequest) {
    const customer = await this.context.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    return listCustomerOrdersQuery(this.env.DB, {
      customerId: customer.value.customerId,
      requestId: input.requestId,
    });
  }
  async requestCancellation(
    input: import("@freshmarkets/contracts").RequestOrderCancellationRequest,
  ) {
    const customerOrStaff = await this.context.session(input);
    if (!customerOrStaff)
      return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const result = await cancelOrder(this.env.DB, {
      orderId: input.orderId,
      expectedVersion: input.expectedVersion,
      reasonCode: input.reason,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });
    if (!result.ok)
      return fail(result.error.code as AppErrorCode, result.error.message, input.requestId);
    return {
      ok: true as const,
      value: { orderId: input.orderId, cancellationRequestedAt: new Date().toISOString() },
      requestId: input.requestId,
    };
  }

  async adjustInventory(input: import("@freshmarkets/contracts").InventoryAdjustmentRequest) {
    const validation = inventoryAdjustmentSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    if (!(await this.context.requireOperationalAccess(input, "inventory:manage", input.locationId)))
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
      !(await this.context.requireOperationalAccess(input, "procurement:manage", input.locationId))
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
          this.context.requireOperationalAccess(input, "procurement:manage", locationId),
      },
    );
  }
  async advanceFulfillment(input: import("@freshmarkets/contracts").FulfillmentCommandRequest) {
    const validation = fulfillmentCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return advanceFulfillmentCommand(this.env.DB, input, {
      authorize: (locationId) =>
        this.context.requireOperationalAccess(input, "fulfillment:manage", locationId),
    });
  }
  async advanceDelivery(input: import("@freshmarkets/contracts").DeliveryCommandRequest) {
    const validation = deliveryCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    return advanceDeliveryCommand(this.env.DB, input, {
      authorize: (locationId) =>
        this.context.requireOperationalAccess(input, "delivery:manage", locationId),
    });
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
