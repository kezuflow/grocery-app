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
  refreshCheckoutQuote as refreshCheckoutQuoteCommand,
} from "./checkout/application/create-checkout-quote";
import { ProviderRegistry } from "./payments/infrastructure/providers/provider-registry";
import { createPayment as createPaymentIntentCommand } from "./payments/application/create-payment";
import { systemClock, type Clock } from "@freshmarkets/domain-shared";
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
import { findIdempotencyRecord, requestHash } from "./idempotency";
import { isSandboxPaymentEnabled, type PaymentRuntimeEnvironment } from "./payments/sandbox-policy";
import { financialOperationDisposition } from "./orders/financial-safety";
import { adjustInventory as adjustInventoryCommand } from "./inventory/application/adjust-inventory";
import { startReceiving as startReceivingCommand } from "./procurement/application/start-receiving";
import { handleProviderWebhook } from "./payments/http/provider-webhook";
import { recordReceivedLine as recordReceivedLineCommand } from "./procurement/application/record-received-line";
import { startPromotionalTrial as startPromotionalTrialCommand } from "./membership/application/start-promotional-trial";
import { buildInventoryCommitPlan } from "./commerce/inventory-plan";
import { expireCheckoutAttempts } from "./commerce/reconciliation";
import { drizzle } from "drizzle-orm/d1";
import { log, requestId } from "./observability";
import { applicationContext, hasOperationalScope } from "./auth/authorization";
import { createAuth, type AuthEnvironment } from "./auth/service";
import { iamSchema } from "./iam/schema";
import { resolveServiceability } from "./geography/serviceability";
import { getProduct, listCategories, searchCatalog } from "./catalog/service";
import { checkoutEligibility } from "./commerce/service";
import {
  transition,
  fulfillmentTransitions,
  deliveryTransitions,
  orderTransitions,
} from "./commerce/state-machines";

type SessionUser = { id: string; email: string; name: string; emailVerified: boolean };
type AuthenticatedCustomer = {
  user: SessionUser;
  principalId: string;
  customerId: string;
  customerStatus: string;
};
type CustomerAddressRow = {
  id: string;
  customer_id: string;
  label: string;
  recipient: string;
  phone: string;
  address_json: string;
  latitude: number;
  longitude: number;
  service_area_code: string | null;
  delivery_zone_code: string | null;
  resolution_version: number | null;
  serviceable: number | null;
  serviceability_reason: import("@freshmarkets/contracts").ServiceabilityFailureReason | null;
  notes: string | null;
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
};

function customerAddressView(row: CustomerAddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
    latitude: row.latitude,
    longitude: row.longitude,
    serviceable: row.serviceable === null ? null : row.serviceable === 1,
    serviceabilityReason: row.serviceability_reason,
    serviceAreaCode: row.service_area_code,
    deliveryZoneCode: row.delivery_zone_code,
    resolutionVersion: row.resolution_version,
    status: row.status,
    version: row.version,
  };
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

export class CoreEntrypoint extends WorkerEntrypoint<Env> {
  private readonly clock: Clock = systemClock;

  private now(): number {
    return this.clock.now().getTime();
  }

  private async activeMarketCode(): Promise<string | null> {
    const row = await this.env.DB.prepare(
      "SELECT code FROM market WHERE status='active' AND is_default=1",
    ).first<{ code: string }>();
    return row?.code ?? null;
  }

  private async activeFulfillmentLocationId(marketCode: string | null): Promise<string | null> {
    const row = await this.env.DB.prepare(
      "SELECT fl.id FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id WHERE fl.status='active' AND fl.is_default=1 AND m.status='active' AND (? IS NULL OR m.code=?)",
    )
      .bind(marketCode, marketCode)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  private async defaultCurrency(): Promise<string | null> {
    const row = await this.env.DB.prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency FROM market m LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE m.status='active' AND m.is_default=1",
    ).first<{ currency: string }>();
    return row?.currency ?? null;
  }

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
    if (path.startsWith("/api/auth")) return this.handleAuthHttp(request);
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

  private async session(input: AuthenticatedRequest): Promise<SessionUser | null> {
    const session = await createAuth(this.env as Env & AuthEnvironment).api.getSession({
      headers: new Headers(input.headers),
    });
    return session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        }
      : null;
  }
  private async resolveAuthenticatedCustomer(
    input: AuthenticatedRequest,
  ): Promise<
    | { ok: true; value: AuthenticatedCustomer; requestId: string }
    | { ok: false; error: ReturnType<typeof fail>["error"] }
  > {
    const user = await this.session(input);
    if (!user) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);

    let principal = await this.env.DB.prepare(
      "SELECT id, status FROM customer_principal WHERE auth_user_id=?",
    )
      .bind(user.id)
      .first<{ id: string; status: string }>();
    if (!principal) {
      const principalId = crypto.randomUUID();
      await this.env.DB.prepare(
        "INSERT OR IGNORE INTO customer_principal (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      )
        .bind(principalId, user.id, this.now(), this.now())
        .run();
      principal = await this.env.DB.prepare(
        "SELECT id, status FROM customer_principal WHERE auth_user_id=?",
      )
        .bind(user.id)
        .first<{ id: string; status: string }>();
    }
    if (!principal)
      return fail("INTERNAL_ERROR", "Customer principal could not be resolved", input.requestId);
    if (principal.status !== "active")
      return fail("FORBIDDEN", "Customer access is disabled", input.requestId);

    let customer = await this.env.DB.prepare("SELECT id, status FROM customer WHERE principal_id=?")
      .bind(principal.id)
      .first<{ id: string; status: string }>();
    if (!customer) {
      const legacy = await this.env.DB.prepare(
        "SELECT id, status FROM customer WHERE auth_user_id=? AND principal_id IS NULL",
      )
        .bind(user.id)
        .first<{ id: string; status: string }>();
      if (legacy) {
        await this.env.DB.prepare(
          "UPDATE customer SET principal_id=? WHERE id=? AND principal_id IS NULL",
        )
          .bind(principal.id, legacy.id)
          .run();
      } else {
        const customerId = crypto.randomUUID();
        await this.env.DB.prepare(
          "INSERT OR IGNORE INTO customer (id, auth_user_id, principal_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
        )
          .bind(customerId, user.id, principal.id, this.now(), this.now())
          .run();
      }
      customer = await this.env.DB.prepare("SELECT id, status FROM customer WHERE principal_id=?")
        .bind(principal.id)
        .first<{ id: string; status: string }>();
    }
    if (!customer)
      return fail("INTERNAL_ERROR", "Customer aggregate could not be reconciled", input.requestId);
    if (customer.status !== "active")
      return fail("FORBIDDEN", "Customer access is disabled", input.requestId);
    return {
      ok: true,
      value: {
        user,
        principalId: principal.id,
        customerId: customer.id,
        customerStatus: customer.status,
      },
      requestId: input.requestId,
    };
  }

  // Retained for existing internal callers; boundary resolution above remains authoritative.
  private async customer(input: AuthenticatedRequest) {
    const resolved = await this.resolveAuthenticatedCustomer(input);
    if (!resolved.ok) return null;
    return {
      id: resolved.value.customerId,
      auth_user_id: resolved.value.user.id,
      user: resolved.value.user,
    };
  }

  private async requireCapability(
    input: AuthenticatedRequest,
    capability: import("@freshmarkets/contracts").Capability,
  ) {
    const context = await this.getApplicationContext({
      headers: input.headers,
      requestId: input.requestId,
    });
    return context.ok &&
      context.value.authenticated &&
      context.value.capabilities.includes(capability)
      ? context.value
      : null;
  }

  private async requireOperationalAccess(
    input: AuthenticatedRequest,
    capability: import("@freshmarkets/contracts").Capability,
    locationId: string,
  ) {
    const context = await this.requireCapability(input, capability);
    if (!context) return false;
    const location = await this.env.DB.prepare(
      "SELECT market_id FROM fulfillment_location WHERE id=?",
    )
      .bind(locationId)
      .first<{ market_id: string }>();
    return hasOperationalScope(context.scopes, locationId, location?.market_id);
  }

  private transitionOrError(
    current: string,
    next: string,
    legal: Readonly<Record<string, ReadonlyArray<string>>>,
    requestId: string,
  ) {
    try {
      return { ok: true as const, value: transition(current, next, legal) };
    } catch {
      return {
        ok: false as const,
        error: {
          code: "ILLEGAL_TRANSITION" as const,
          message: `Cannot move ${current} to ${next}`,
          requestId,
        },
      };
    }
  }

  private async claimCommandIdempotency(scope: string, key: string, payload: unknown) {
    const hash = await requestHash(payload);
    const existing = await findIdempotencyRecord(this.env.DB, scope, key);
    if (existing) {
      if (existing.requestHash !== hash) return { hash, existing, claimed: false };
      if (existing.status === "FAILED") {
        const reclaimed = await this.env.DB.prepare(
          "UPDATE idempotency_records SET status='PROCESSING', result_reference=NULL, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='FAILED'",
        )
          .bind(this.now(), scope, key, hash)
          .run();
        if ((reclaimed.meta?.changes ?? 0) === 1) return { hash, existing: null, claimed: true };
        return {
          hash,
          existing: await findIdempotencyRecord(this.env.DB, scope, key),
          claimed: false,
        };
      }
      return { hash, existing, claimed: false };
    }
    const now = this.now();
    const result = await this.env.DB.prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?)",
    )
      .bind(scope, key, hash, scope, now, now)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      return {
        hash,
        existing: await findIdempotencyRecord(this.env.DB, scope, key),
        claimed: false,
      };
    }
    return { hash, existing: null, claimed: true };
  }

  async createCustomerAddress(
    input: import("@freshmarkets/contracts").CreateCustomerAddressRequest,
  ) {
    const validation = addressRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const geo = await resolveServiceability(drizzle(this.env.DB), input);
    if (!geo.ok) return { ok: false as const, error: geo.error };
    const id = crypto.randomUUID();
    const now = this.now();
    await this.env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    )
      .bind(
        id,
        customer.value.customerId,
        input.label,
        input.recipient,
        input.phone,
        input.addressJson,
        input.latitude,
        input.longitude,
        geo.value.serviceArea?.code ?? null,
        geo.value.deliveryZone?.code ?? null,
        geo.value.serviceArea?.polygonVersion ?? null,
        geo.value.serviceable ? 1 : 0,
        geo.value.reason,
        input.notes ?? null,
        now,
        now,
      )
      .run();
    return {
      ok: true as const,
      value: {
        id,
        label: input.label,
        recipient: input.recipient,
        latitude: input.latitude,
        longitude: input.longitude,
        serviceable: geo.value.serviceable,
        serviceabilityReason: geo.value.reason,
        serviceAreaCode: geo.value.serviceArea?.code ?? null,
        deliveryZoneCode: geo.value.deliveryZone?.code ?? null,
        resolutionVersion: geo.value.serviceArea?.polygonVersion ?? null,
        status: "active",
        version: 1,
      },
      requestId: input.requestId,
    };
  }

  async listCustomerAddresses(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const rows = await this.env.DB.prepare(
      "SELECT id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at FROM customer_address WHERE customer_id=? AND status='active' ORDER BY updated_at DESC, id DESC",
    )
      .bind(customer.value.customerId)
      .all<CustomerAddressRow>();
    return {
      ok: true as const,
      value: rows.results.map(customerAddressView),
      requestId: input.requestId,
    };
  }

  async updateCustomerAddress(
    input: import("@freshmarkets/contracts").UpdateCustomerAddressRequest,
  ) {
    const validation = addressUpdateRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const current = await this.env.DB.prepare(
      "SELECT id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
    )
      .bind(input.addressId, customer.value.customerId)
      .first<CustomerAddressRow>();
    if (!current) return fail("NOT_FOUND", "Customer address not found", input.requestId);

    const latitude = input.latitude ?? current.latitude;
    const longitude = input.longitude ?? current.longitude;
    const locationChanged = latitude !== current.latitude || longitude !== current.longitude;
    let serviceability = {
      serviceAreaCode: current.service_area_code,
      deliveryZoneCode: current.delivery_zone_code,
      resolutionVersion: current.resolution_version,
      serviceable: current.serviceable,
      reason: current.serviceability_reason,
    };
    if (locationChanged) {
      const geo = await resolveServiceability(drizzle(this.env.DB), {
        requestId: input.requestId,
        latitude,
        longitude,
        previousResolution:
          current.service_area_code && current.resolution_version !== null
            ? {
                serviceAreaCode: current.service_area_code,
                serviceAreaPolygonVersion: current.resolution_version,
                deliveryZoneCode: current.delivery_zone_code,
                deliveryZonePolygonVersion: null,
              }
            : undefined,
      });
      if (!geo.ok) return geo;
      serviceability = {
        serviceAreaCode: geo.value.serviceArea?.code ?? null,
        deliveryZoneCode: geo.value.deliveryZone?.code ?? null,
        resolutionVersion: geo.value.serviceArea?.polygonVersion ?? null,
        serviceable: geo.value.serviceable ? 1 : 0,
        reason: geo.value.reason,
      };
    }

    const updated = await this.env.DB.prepare(
      "UPDATE customer_address SET label=?, recipient=?, phone=?, address_json=?, latitude=?, longitude=?, service_area_code=?, delivery_zone_code=?, resolution_version=?, serviceable=?, serviceability_reason=?, notes=?, version=version+1, updated_at=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
    )
      .bind(
        input.label ?? current.label,
        input.recipient ?? current.recipient,
        input.phone ?? current.phone,
        input.addressJson ?? current.address_json,
        latitude,
        longitude,
        serviceability.serviceAreaCode,
        serviceability.deliveryZoneCode,
        serviceability.resolutionVersion,
        serviceability.serviceable,
        serviceability.reason,
        input.notes !== undefined ? input.notes : current.notes,
        this.now(),
        current.id,
        customer.value.customerId,
        input.expectedVersion,
      )
      .run();
    if ((updated.meta?.changes ?? 0) !== 1)
      return fail("STALE_VERSION", "Address changed; refresh before updating", input.requestId);

    const row = await this.env.DB.prepare(
      "SELECT id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, serviceable, serviceability_reason, notes, status, version, created_at, updated_at FROM customer_address WHERE id=? AND customer_id=?",
    )
      .bind(current.id, customer.value.customerId)
      .first<CustomerAddressRow>();
    if (!row) return fail("INTERNAL_ERROR", "Updated address could not be read", input.requestId);
    return { ok: true as const, value: customerAddressView(row), requestId: input.requestId };
  }
  async startTrial(input: import("@freshmarkets/contracts").StartTrialRequest) {
    const validation = authenticatedRequestSchema
      .extend({ idempotencyKey: idempotencyKeySchema })
      .safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
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
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const row = await this.env.DB.prepare(
      "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(customer.value.customerId)
      .first<{ status: string; trial_ends_at: number | null }>();
    const eligible = Boolean(
      row &&
      ["ACTIVE", "TRIALING"].includes(row.status) &&
      (!row.trial_ends_at || row.trial_ends_at > this.now()),
    );
    return {
      ok: true as const,
      value: {
        eligible,
        state: (row?.status ?? null) as import("@freshmarkets/contracts").SubscriptionState | null,
        trialEndsAt: row?.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
      },
      requestId: input.requestId,
    };
  }
  async listDeliveryCycles(input: import("@freshmarkets/contracts").DeliveryCycleRequest) {
    const marketCode = input.marketCode ?? (await this.activeMarketCode());
    if (!marketCode)
      return {
        ok: true as const,
        value: [],
        requestId: input.requestId,
      };
    const rows = await this.env.DB.prepare(
      "SELECT dc.id, dc.name, dc.cutoff_at, dc.delivery_date, dc.status, COALESCE((SELECT MIN(czc.capacity-czc.allocated) FROM cycle_zone_capacity czc WHERE czc.cycle_id=dc.id), dc.capacity-dc.allocated) AS capacity_remaining FROM delivery_cycle dc JOIN market m ON m.id=dc.market_id WHERE m.code=? ORDER BY dc.delivery_date",
    )
      .bind(marketCode)
      .all<{
        id: string;
        name: string;
        cutoff_at: number;
        delivery_date: number;
        status: string;
        capacity_remaining: number;
      }>();
    return {
      ok: true as const,
      value: rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        cutoffAt: new Date(r.cutoff_at).toISOString(),
        deliveryDate: new Date(r.delivery_date).toISOString(),
        status: r.status,
        capacityRemaining: r.capacity_remaining,
      })),
      requestId: input.requestId,
    };
  }

  async getCart(input: AuthenticatedRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    let cart = await this.env.DB.prepare(
      "SELECT id, location_id, version FROM cart WHERE customer_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(customer.value.customerId)
      .first<{ id: string; location_id: string; version: number }>();
    if (!cart) {
      const locationId = await this.activeFulfillmentLocationId(await this.activeMarketCode());
      if (!locationId)
        return fail(
          "CONFIGURATION_ERROR",
          "No active fulfillment location is configured",
          input.requestId,
        );
      cart = { id: crypto.randomUUID(), location_id: locationId, version: 1 };
      await this.env.DB.prepare(
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)",
      )
        .bind(cart.id, customer.value.customerId, locationId, this.now(), this.now())
        .run();
    }
    const currency = await this.env.DB.prepare(
      "SELECT COALESCE(mcp.currency, m.currency) AS currency FROM fulfillment_location fl JOIN market m ON m.id=fl.market_id LEFT JOIN market_commerce_policy mcp ON mcp.market_id=m.id WHERE fl.id=?",
    )
      .bind(cart.location_id)
      .first<{ currency: string }>();
    if (!currency)
      return fail("CONFIGURATION_ERROR", "Cart market currency is not configured", input.requestId);
    const rows = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name, COALESCE((SELECT amount_minor FROM price_version pv JOIN fulfillment_location fl ON fl.id=c.location_id WHERE pv.sku_id=s.id AND pv.market_id=fl.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=c.location_id) AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1),0) AS unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN cart c ON c.id=ci.cart_id WHERE ci.cart_id=? ORDER BY s.sort_order",
    )
      .bind(currency.currency, this.now(), this.now(), cart.id)
      .all<{ sku_id: string; quantity: number; name: string; unit_price_minor: number }>();
    const items = rows.results.map((r) => ({
      skuId: r.sku_id,
      quantity: r.quantity,
      name: r.name,
      unitPriceMinor: r.unit_price_minor,
      lineTotalMinor: r.quantity * r.unit_price_minor,
    }));
    return {
      ok: true as const,
      value: {
        id: cart.id,
        version: cart.version,
        items,
        totalMinor: items.reduce((sum, i) => sum + i.lineTotalMinor, 0),
        currency: currency.currency,
      },
      requestId: input.requestId,
    };
  }
  async setCartItem(input: import("@freshmarkets/contracts").SetCartItemRequest) {
    const validation = setCartItemRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const current = await this.getCart(input);
    if (!current.ok) return current;
    const sku = await this.env.DB.prepare("SELECT id FROM sku WHERE id=? AND status='active'")
      .bind(input.skuId)
      .first<{ id: string }>();
    if (!sku) return fail("NOT_FOUND", "SKU not found", input.requestId);
    const statement =
      input.quantity > 0
        ? this.env.DB.prepare(
            "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, ?, ?) ON CONFLICT(cart_id, sku_id) DO UPDATE SET quantity=excluded.quantity",
          ).bind(current.value.id, input.skuId, input.quantity)
        : this.env.DB.prepare("DELETE FROM cart_item WHERE cart_id=? AND sku_id=?").bind(
            current.value.id,
            input.skuId,
          );
    await this.env.DB.batch([
      statement,
      this.env.DB.prepare("UPDATE cart SET version=version+1, updated_at=? WHERE id=?").bind(
        this.now(),
        current.value.id,
      ),
    ]);
    return this.getCart(input);
  }

  async evaluateCheckout(input: import("@freshmarkets/contracts").CheckoutEligibilityRequest) {
    const validation = checkoutRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const [subscription, address, cycle, policy] = await Promise.all([
      this.env.DB.prepare(
        "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
      )
        .bind(customer.value.customerId)
        .first<{ status: string; trial_ends_at: number | null }>(),
      this.env.DB.prepare(
        "SELECT latitude, longitude, delivery_zone_code FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
        .bind(input.addressId, customer.value.customerId)
        .first<{ latitude: number; longitude: number; delivery_zone_code: string | null }>(),
      this.env.DB.prepare(
        "SELECT id, status, cutoff_at, capacity, allocated FROM delivery_cycle WHERE id=?",
      )
        .bind(input.cycleId)
        .first<{
          id: string;
          status: string;
          cutoff_at: number;
          capacity: number;
          allocated: number;
        }>(),
      this.env.DB.prepare(
        "SELECT mcp.minimum_basket_minor, mcp.currency FROM delivery_cycle dc JOIN market_commerce_policy mcp ON mcp.market_id=dc.market_id WHERE dc.id=?",
      )
        .bind(input.cycleId)
        .first<{ minimum_basket_minor: number; currency: string }>(),
    ]);
    const routing = address?.delivery_zone_code
      ? await this.env.DB.prepare(
          "SELECT dz.id zone_id, ls.location_id FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id JOIN delivery_cycle dc ON dc.market_id=sa.market_id JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1 JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.market_id=dc.market_id AND fl.status='active' WHERE dz.code=? AND dz.status='active' AND dc.id=? ORDER BY ls.priority LIMIT 1",
        )
          .bind(address.delivery_zone_code, input.cycleId)
          .first<{ zone_id: string; location_id: string }>()
      : null;
    const [cart, fee, zoneCapacity] = await Promise.all([
      this.env.DB.prepare(
        "SELECT c.id, COALESCE(SUM(ci.quantity * COALESCE((SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=? WHERE pv.sku_id=ci.sku_id AND pv.market_id=dc.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=?) AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1),0)),0) AS total_minor FROM cart c LEFT JOIN cart_item ci ON ci.cart_id=c.id WHERE c.id=? AND c.customer_id=? AND c.status='ACTIVE' GROUP BY c.id",
      )
        .bind(
          input.cycleId,
          policy?.currency ?? "",
          routing?.location_id ?? null,
          this.now(),
          this.now(),
          input.cartId,
          customer.value.customerId,
        )
        .first<{ id: string; total_minor: number }>(),
      routing
        ? this.env.DB.prepare(
            "SELECT fee_minor, currency FROM delivery_zone_fee WHERE zone_id=? AND location_id=? AND status='active'",
          )
            .bind(routing.zone_id, routing.location_id)
            .first<{ fee_minor: number; currency: string }>()
        : null,
      routing
        ? this.env.DB.prepare(
            "SELECT capacity-allocated AS remaining FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
          )
            .bind(input.cycleId, routing.zone_id, routing.location_id)
            .first<{ remaining: number }>()
        : null,
    ]);
    const geo = address
      ? await resolveServiceability(drizzle(this.env.DB), {
          requestId: input.requestId,
          latitude: address.latitude,
          longitude: address.longitude,
        })
      : null;
    const eligibility = checkoutEligibility(
      {
        requestId: input.requestId,
        latitude: address?.latitude ?? 0,
        longitude: address?.longitude ?? 0,
        customerId: customer.value.customerId,
        hasEligibleSubscription: Boolean(
          subscription &&
          ["ACTIVE", "TRIALING"].includes(subscription.status) &&
          (!subscription.trial_ends_at || subscription.trial_ends_at > this.now()),
        ),
      },
      Boolean(geo?.ok && geo.value.serviceable),
    );
    const failures = [...eligibility.failures];
    if (!address) failures.push("ADDRESS_REQUIRED");
    if (address && !routing) failures.push("ADDRESS_NOT_SERVICEABLE");
    if (!cycle || cycle.status !== "OPEN" || cycle.cutoff_at <= this.now())
      failures.push("CYCLE_CLOSED");
    if (zoneCapacity?.remaining !== null && zoneCapacity?.remaining !== undefined) {
      if (zoneCapacity.remaining <= 0) failures.push("CYCLE_FULL");
    } else if (cycle && cycle.allocated >= cycle.capacity) failures.push("CYCLE_FULL");
    if (!policy) failures.push("CONFIGURATION_ERROR");
    if (routing && !fee) failures.push("CONFIGURATION_ERROR");
    if (policy && fee && policy.currency !== fee.currency) failures.push("CONFIGURATION_ERROR");
    if (cart && policy && cart.total_minor < policy.minimum_basket_minor)
      failures.push("MINIMUM_ORDER_NOT_MET");
    if (!cart) failures.push("MINIMUM_ORDER_NOT_MET");
    const totalMinor = (cart?.total_minor ?? 0) + (fee?.fee_minor ?? 0);
    return {
      ok: true as const,
      value: {
        eligible: failures.length === 0,
        failures,
        totalMinor,
        currency: policy?.currency ?? fee?.currency ?? (await this.defaultCurrency()) ?? "",
      },
      requestId: input.requestId,
    };
  }

  async createCheckoutQuote(input: import("@freshmarkets/contracts").CheckoutQuoteCommandRequest) {
    const validation = createCheckoutQuoteSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
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
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const repository = (
      await import("./checkout/infrastructure/d1-checkout-repository")
    ).createCheckoutRepository(this.env.DB);
    const quote = await repository.findQuoteById(input.quoteId);
    if (!quote || quote.customerId !== customer.value.customerId)
      return fail("NOT_FOUND", "Quote not found", input.requestId);
    return refreshCheckoutQuoteCommand(this.env.DB, {
      quoteId: input.quoteId,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
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
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const repository = (
      await import("./checkout/infrastructure/d1-checkout-repository")
    ).createCheckoutRepository(this.env.DB);
    const quote = await repository.findQuoteById(input.checkoutAttemptId);
    if (!quote || quote.customerId !== customer.value.customerId || quote.status !== "ACTIVE")
      return fail("CONFLICT", "A valid quote is required to start payment", input.requestId);
    const registry = new ProviderRegistry((this.env as PaymentRuntimeEnvironment).ENVIRONMENT);
    return createPaymentIntentCommand(this.env.DB, registry, {
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_quote",
      subjectId: quote.id,
      customerId: customer.value.customerId,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      providerCode: input.providerCode ?? "",
      returnUrl: input.returnUrl,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });
  }

  async listCustomerOrders(input: AuthenticatedRequest) {
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const rows = await this.env.DB.prepare(
      "SELECT o.id,o.status,c.delivery_date,o.total_minor,o.currency,(SELECT COUNT(*) FROM order_item oi WHERE oi.order_id=o.id) item_count FROM grocery_order o JOIN delivery_cycle c ON c.id=o.cycle_id WHERE o.customer_id=? ORDER BY o.created_at DESC",
    )
      .bind(customer.value.customerId)
      .all<{
        id: string;
        status: string;
        delivery_date: number;
        total_minor: number;
        currency: string;
        item_count: number;
      }>();
    return {
      ok: true as const,
      value: rows.results.map((r) => ({
        id: r.id,
        status: r.status,
        deliveryDate: new Date(r.delivery_date).toISOString(),
        totalMinor: r.total_minor,
        currency: r.currency,
        itemCount: r.item_count,
      })),
      requestId: input.requestId,
    };
  }
  async requestCancellation(
    input: import("@freshmarkets/contracts").RequestOrderCancellationRequest,
  ) {
    const customerOrStaff = await this.session(input);
    if (!customerOrStaff)
      return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const { cancelOrder } = await import("./orders/application/cancel-order");
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
    if (!(await this.requireOperationalAccess(input, "inventory:manage", input.locationId)))
      return fail(
        "FORBIDDEN",
        "Inventory capability and location scope are required",
        input.requestId,
      );
    const actor = await this.session(input);
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
    if (!(await this.requireOperationalAccess(input, "procurement:manage", input.locationId)))
      return fail(
        "FORBIDDEN",
        "Procurement capability and location scope are required",
        input.requestId,
      );
    const scope = "procurement.createRequirement";
    const idempotency = await this.claimCommandIdempotency(scope, input.idempotencyKey, {
      deliveryCycleId: input.deliveryCycleId,
      locationId: input.locationId,
      inventoryPoolId: input.inventoryPoolId,
      quantity: input.quantity,
    });
    if (idempotency.existing) {
      if (idempotency.existing.requestHash !== idempotency.hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (idempotency.existing.status === "SUCCEEDED" && idempotency.existing.resultReference) {
        const prior = await this.env.DB.prepare(
          "SELECT status FROM procurement_requirement WHERE id=?",
        )
          .bind(idempotency.existing.resultReference)
          .first<{ status: string }>();
        if (prior)
          return {
            ok: true as const,
            value: { id: idempotency.existing.resultReference, status: prior.status },
            requestId: input.requestId,
          };
      }
      return fail(
        "CONFLICT",
        "The original procurement command is still processing",
        input.requestId,
      );
    }
    const id = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status) VALUES (?, ?, ?, ?, ?, 'DRAFT')",
      ).bind(id, input.deliveryCycleId, input.locationId, input.inventoryPoolId, input.quantity),
      this.env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status) VALUES (?, ?, ?, 0, 0, 'PENDING')",
      ).bind(crypto.randomUUID(), id, input.quantity),
      this.env.DB.prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      ).bind(id, this.now(), scope, input.idempotencyKey, idempotency.hash),
    ]);
    return { ok: true as const, value: { id, status: "DRAFT" }, requestId: input.requestId };
  }
  async receiveProcurement(input: import("@freshmarkets/contracts").ReceivingCommandRequest) {
    const validation = receivingCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const requirement = await this.env.DB.prepare(
      "SELECT id, location_id, status FROM procurement_requirement WHERE id=?",
    )
      .bind(input.requirementId)
      .first<{ id: string; location_id: string; status: string }>();
    if (!requirement)
      return fail("NOT_FOUND", "Procurement requirement not found", input.requestId);
    if (
      !(await this.requireOperationalAccess(input, "procurement:manage", requirement.location_id))
    )
      return fail(
        "FORBIDDEN",
        "Procurement capability and location scope are required",
        input.requestId,
      );
    const actor = await this.session(input);
    if (!actor) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const record = await this.env.DB.prepare(
      "SELECT id, status, version FROM receiving_record WHERE procurement_requirement_id=? ORDER BY rowid ASC LIMIT 1",
    )
      .bind(input.requirementId)
      .first<{ id: string; status: string; version: number }>();
    if (!record) return fail("NOT_FOUND", "Receiving record not found", input.requestId);
    let lineVersion = record.version;
    if (record.status === "PENDING") {
      const started = await startReceivingCommand(this.env.DB, {
        requirementId: input.requirementId,
        expectedVersion: record.version,
        idempotencyKey: input.idempotencyKey,
        actorId: actor.id,
        requestId: input.requestId,
      });
      if (!started.ok) return started;
      lineVersion = started.value.version;
    }
    const result = await recordReceivedLineCommand(this.env.DB, {
      receivingRecordId: record.id,
      acceptedDeltaBase: input.acceptedQuantity,
      rejectedDeltaBase: input.rejectedQuantity,
      reason: input.reason ?? "PROCUREMENT_RECEIPT",
      expectedVersion: lineVersion,
      idempotencyKey: input.idempotencyKey,
      actorId: actor.id,
      requestId: input.requestId,
    });
    if (result.ok)
      return {
        ok: true as const,
        value: {
          receivingRecordId: result.value.receivingRecordId,
          status: result.value.status,
          acceptedBase: result.value.acceptedBase,
          rejectedBase: result.value.rejectedBase,
          remainingBase: result.value.remainingBase,
          version: result.value.version,
        },
        requestId: input.requestId,
      };
    return result;
  }
  async advanceFulfillment(input: import("@freshmarkets/contracts").FulfillmentCommandRequest) {
    const validation = fulfillmentCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const row = await this.env.DB.prepare(
      "SELECT status, location_id, version FROM fulfillment_record WHERE order_id=?",
    )
      .bind(input.orderId)
      .first<{ status: string; location_id: string; version: number }>();
    if (!row) return fail("NOT_FOUND", "Fulfillment record not found", input.requestId);
    if (!(await this.requireOperationalAccess(input, "fulfillment:manage", row.location_id)))
      return fail(
        "FORBIDDEN",
        "Fulfillment capability and location scope are required",
        input.requestId,
      );
    const transitionResult = this.transitionOrError(
      row.status,
      input.action === "START" ? "PICKING" : input.action === "PACK" ? "PACKED" : "SHORTAGE",
      fulfillmentTransitions,
      input.requestId,
    );
    if (!transitionResult.ok) return transitionResult;
    const next = transitionResult.value;
    const scope = "fulfillment.advance";
    const idempotency = await this.claimCommandIdempotency(scope, input.idempotencyKey, {
      orderId: input.orderId,
      action: input.action,
      expectedVersion: input.expectedVersion,
    });
    if (idempotency.existing) {
      if (idempotency.existing.requestHash !== idempotency.hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (idempotency.existing.status === "SUCCEEDED")
        return {
          ok: true as const,
          value: { id: input.orderId, status: next },
          requestId: input.requestId,
        };
      return fail(
        "CONFLICT",
        "The original fulfillment command is still processing",
        input.requestId,
      );
    }
    const result = await this.env.DB.prepare(
      "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=? AND version=?",
    )
      .bind(next, this.now(), input.orderId, input.expectedVersion)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      await this.env.DB.prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
        .bind(this.now(), scope, input.idempotencyKey)
        .run();
      return fail("STALE_VERSION", "Fulfillment changed; refresh before retrying", input.requestId);
    }
    await this.env.DB.prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
      .bind(input.orderId, this.now(), scope, input.idempotencyKey, idempotency.hash)
      .run();
    return {
      ok: true as const,
      value: { id: input.orderId, status: next },
      requestId: input.requestId,
    };
  }
  async advanceDelivery(input: import("@freshmarkets/contracts").DeliveryCommandRequest) {
    const validation = deliveryCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const row = await this.env.DB.prepare(
      "SELECT d.status, d.version, f.location_id FROM delivery_job d LEFT JOIN fulfillment_record f ON f.order_id=d.order_id WHERE d.order_id=?",
    )
      .bind(input.orderId)
      .first<{ status: string; version: number; location_id: string | null }>();
    if (!row) return fail("NOT_FOUND", "Delivery job not found", input.requestId);
    const deliveryLocationId =
      row.location_id ?? (await this.activeFulfillmentLocationId(await this.activeMarketCode()));
    if (!deliveryLocationId)
      return fail(
        "CONFIGURATION_ERROR",
        "No active fulfillment location is configured",
        input.requestId,
      );
    if (!(await this.requireOperationalAccess(input, "delivery:manage", deliveryLocationId)))
      return fail(
        "FORBIDDEN",
        "Delivery capability and location scope are required",
        input.requestId,
      );
    const transitionResult = this.transitionOrError(
      row.status,
      input.action === "DISPATCH"
        ? "DISPATCHED"
        : input.action === "DELIVER"
          ? "DELIVERED"
          : "FAILED",
      deliveryTransitions,
      input.requestId,
    );
    if (!transitionResult.ok) return transitionResult;
    const next = transitionResult.value;
    const scope = "delivery.advance";
    const idempotency = await this.claimCommandIdempotency(scope, input.idempotencyKey, {
      orderId: input.orderId,
      action: input.action,
      expectedVersion: input.expectedVersion,
    });
    if (idempotency.existing) {
      if (idempotency.existing.requestHash !== idempotency.hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (idempotency.existing.status === "SUCCEEDED")
        return {
          ok: true as const,
          value: { id: input.orderId, status: next },
          requestId: input.requestId,
        };
      return fail("CONFLICT", "The original delivery command is still processing", input.requestId);
    }
    const deliveryUpdate = this.env.DB.prepare(
      "UPDATE delivery_job SET status=?, delivered_at=?, version=version+1 WHERE order_id=? AND version=?",
    ).bind(next, next === "DELIVERED" ? this.now() : null, input.orderId, input.expectedVersion);
    const statements = [deliveryUpdate];
    if (next === "DELIVERED")
      statements.push(
        this.env.DB.prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?").bind(
          input.orderId,
        ),
      );
    const results = await this.env.DB.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      await this.env.DB.prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
        .bind(this.now(), scope, input.idempotencyKey)
        .run();
      return fail("STALE_VERSION", "Delivery changed; refresh before retrying", input.requestId);
    }
    if (next === "DELIVERED" && (results[1]?.meta?.changes ?? 0) !== 1)
      return fail("NOT_FOUND", "Order not found while completing delivery", input.requestId);
    await this.env.DB.prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
      .bind(input.orderId, this.now(), scope, input.idempotencyKey, idempotency.hash)
      .run();
    return {
      ok: true as const,
      value: { id: input.orderId, status: next },
      requestId: input.requestId,
    };
  }
  private async handleAuthHttp(request: Request): Promise<Response> {
    return await createAuth(this.env as Env & AuthEnvironment).handler(request);
  }
}
function fail(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
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
