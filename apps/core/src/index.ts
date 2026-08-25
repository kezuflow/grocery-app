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
import { systemClock, type Clock } from "@freshmarkets/domain-shared";
import {
  addressRequestSchema,
  addressUpdateRequestSchema,
  adminOrderCommandSchema,
  authenticatedRequestSchema,
  catalogProductRequestSchema,
  catalogSearchRequestSchema,
  checkoutRequestSchema,
  commitOrderRequestSchema,
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
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const existing = await this.env.DB.prepare(
      "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(customer.value.customerId)
      .first<{ status: string; trial_ends_at: number | null }>();
    if (existing)
      return {
        ok: true as const,
        value: {
          eligible: ["ACTIVE", "TRIALING"].includes(existing.status),
          status: existing.status,
          trialEndsAt: existing.trial_ends_at
            ? new Date(existing.trial_ends_at).toISOString()
            : null,
        },
        requestId: input.requestId,
      };
    const offer = await this.env.DB.prepare(
      "SELECT id, trial_days FROM subscription_offer WHERE status='active' AND ((? IS NOT NULL AND code=?) OR (? IS NULL AND is_default=1))",
    )
      .bind(input.offerCode ?? null, input.offerCode ?? null, input.offerCode ?? null)
      .first<{ id: string; trial_days: number }>();
    if (!offer) return fail("NOT_FOUND", "Subscription offer not found", input.requestId);
    const now = this.now();
    const trialEnds = now + offer.trial_days * 86400000;
    const subscriptionId = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES (?, ?, ?, 'TRIALING', ?, ?, ?, ?)",
    )
      .bind(subscriptionId, customer.value.customerId, offer.id, now, trialEnds, now, now)
      .run();
    await this.env.DB.prepare(
      "INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id, details_json, occurred_at) VALUES (?, ?, 'TRIAL_STARTED', 'subscription', ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        customer.value.user.id,
        subscriptionId,
        JSON.stringify({ offerId: offer.id }),
        now,
      )
      .run();
    return {
      ok: true as const,
      value: { eligible: true, status: "TRIALING", trialEndsAt: new Date(trialEnds).toISOString() },
      requestId: input.requestId,
    };
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
        status: row?.status ?? null,
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

  async commitMockOrder(input: import("@freshmarkets/contracts").CommitMockOrderRequest) {
    if (!isSandboxPaymentEnabled(this.env as PaymentRuntimeEnvironment)) {
      return fail(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "A payment provider is not configured for this environment.",
        input.requestId,
      );
    }
    const validation = commitOrderRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const scope = "checkout.commitMockOrder";
    await expireCheckoutAttempts(this.env.DB, this.now());
    const hash = await requestHash({
      cartId: input.cartId,
      addressId: input.addressId,
      cycleId: input.cycleId,
    });
    const canonicalRecord = await findIdempotencyRecord(this.env.DB, scope, input.idempotencyKey);
    if (canonicalRecord) {
      if (canonicalRecord.requestHash !== hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (canonicalRecord.status === "SUCCEEDED" && canonicalRecord.resultReference) {
        const old = await this.env.DB.prepare(
          "SELECT o.id,o.total_minor,o.currency FROM grocery_order o WHERE o.id=?",
        )
          .bind(canonicalRecord.resultReference)
          .first<{ id: string; total_minor: number; currency: string }>();
        if (old)
          return {
            ok: true as const,
            value: {
              orderId: old.id,
              paymentStatus: "SUCCEEDED" as const,
              orderStatus: "COMMITTED" as const,
              totalMinor: old.total_minor,
              currency: old.currency,
            },
            requestId: input.requestId,
          };
      }
      if (canonicalRecord.status === "FAILED") {
        return fail(
          "CONFLICT",
          "The original checkout request failed; submit a new attempt with a new idempotency key",
          input.requestId,
        );
      } else {
        return fail("CONFLICT", "The original request is still processing", input.requestId);
      }
    }
    const prior = await this.env.DB.prepare(
      "SELECT id FROM payment_attempt WHERE idempotency_key=?",
    )
      .bind(input.idempotencyKey)
      .first<{ id: string }>();
    if (prior) {
      const old = await this.env.DB.prepare(
        "SELECT id,total_minor,currency FROM grocery_order WHERE payment_id=?",
      )
        .bind(prior.id)
        .first<{ id: string; total_minor: number; currency: string }>();
      if (old)
        return {
          ok: true as const,
          value: {
            orderId: old.id,
            paymentStatus: "SUCCEEDED" as const,
            orderStatus: "COMMITTED" as const,
            totalMinor: old.total_minor,
            currency: old.currency,
          },
          requestId: input.requestId,
        };
    }
    const check = await this.evaluateCheckout(input);
    if (!check.ok) return check;
    if (!check.value.eligible)
      return fail("VALIDATION_FAILED", check.value.failures.join(","), input.requestId);
    const customer = await this.resolveAuthenticatedCustomer(input);
    if (!customer.ok) return customer;
    const address = await this.env.DB.prepare(
      "SELECT * FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
    )
      .bind(input.addressId, customer.value.customerId)
      .first<CustomerAddressRow>();
    if (!address) return fail("NOT_FOUND", "Customer address not found", input.requestId);
    const routing = await this.env.DB.prepare(
      "SELECT dz.id zone_id, ls.location_id FROM delivery_zone dz JOIN service_area sa ON sa.id=dz.service_area_id JOIN delivery_cycle dc ON dc.market_id=sa.market_id JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1 JOIN fulfillment_location fl ON fl.id=ls.location_id AND fl.market_id=dc.market_id AND fl.status='active' WHERE dz.code=? AND dz.status='active' AND dc.id=? ORDER BY ls.priority LIMIT 1",
    )
      .bind(address.delivery_zone_code, input.cycleId)
      .first<{ zone_id: string; location_id: string }>();
    if (!routing)
      return fail(
        "ADDRESS_NOT_SERVICEABLE",
        "Address has no eligible fulfillment location",
        input.requestId,
      );
    const cart = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name variant_name, p.name product_name, u.symbol unit, s.consumption_base_quantity, p.inventory_pool_id, ip.sourcing_mode, COALESCE((SELECT amount_minor FROM price_version pv JOIN delivery_cycle dc ON dc.id=? WHERE pv.sku_id=s.id AND pv.market_id=dc.market_id AND pv.currency=? AND pv.price_type='STANDARD' AND (pv.location_id IS NULL OR pv.location_id=?) AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY (pv.location_id IS NOT NULL) DESC, pv.version DESC LIMIT 1),0) unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id JOIN unit u ON u.id=s.sellable_unit_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE ci.cart_id=?",
    )
      .bind(
        input.cycleId,
        check.value.currency,
        routing.location_id,
        this.now(),
        this.now(),
        input.cartId,
      )
      .all<{
        sku_id: string;
        quantity: number;
        variant_name: string;
        product_name: string;
        unit: string;
        consumption_base_quantity: number;
        inventory_pool_id: string;
        sourcing_mode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID";
        unit_price_minor: number;
      }>();
    if (cart.results.length === 0)
      return fail("VALIDATION_FAILED", "Cart is empty", input.requestId);
    const now = this.now();
    const checkoutAttemptId = crypto.randomUUID();
    const allocationId = crypto.randomUUID();
    const requested = cart.results.map((item) => ({
      inventoryPoolId: item.inventory_pool_id,
      requestedBase: item.quantity * item.consumption_base_quantity,
      sourcingMode: item.sourcing_mode,
    }));
    const balances = await Promise.all(
      [...new Set(requested.map((item) => item.inventoryPoolId))].map(async (poolId) => {
        const balance = await this.env.DB.prepare(
          "SELECT on_hand, reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
        )
          .bind(routing.location_id, poolId)
          .first<{ on_hand: number; reserved: number }>();
        return {
          inventoryPoolId: poolId,
          onHand: balance?.on_hand ?? 0,
          reserved: balance?.reserved ?? 0,
        };
      }),
    );
    const inventoryPlan = buildInventoryCommitPlan(requested, balances);
    if (inventoryPlan.insufficientStock.length > 0)
      return fail(
        "INSUFFICIENT_STOCK",
        "One or more stocked items are unavailable",
        input.requestId,
      );
    const holds = new Map(
      inventoryPlan.plans.map((plan) => [plan.inventoryPoolId, plan.reservedBase]),
    );
    const claim = await this.env.DB.prepare(
      "INSERT OR IGNORE INTO idempotency_records (scope, idempotency_key, request_hash, result_type, status, created_at, updated_at) VALUES (?, ?, ?, 'grocery_order', 'PROCESSING', ?, ?)",
    )
      .bind(scope, input.idempotencyKey, hash, now, now)
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) {
      const existing = await findIdempotencyRecord(this.env.DB, scope, input.idempotencyKey);
      if (existing?.requestHash !== hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      return fail("CONFLICT", "The original request is still processing", input.requestId);
    }
    const orderId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const holdCount = [...holds.values()].filter((value) => value > 0).length;
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "INSERT INTO checkout_attempts (id, customer_id, cart_id, address_id, cycle_id, zone_id, location_id, status, idempotency_key, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, 1, ?, ?)",
      ).bind(
        checkoutAttemptId,
        customer.value.customerId,
        input.cartId,
        input.addressId,
        input.cycleId,
        routing.zone_id,
        routing.location_id,
        input.idempotencyKey,
        now + 15 * 60 * 1000,
        now,
        now,
      ),
      this.env.DB.prepare(
        "INSERT INTO checkout_quote_snapshots (id, checkout_attempt_id, merchandise_minor, total_minor, currency, item_snapshot_json, eligibility_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        checkoutAttemptId,
        cart.results.reduce((sum, item) => sum + item.quantity * item.unit_price_minor, 0),
        check.value.totalMinor,
        check.value.currency,
        JSON.stringify(cart.results),
        JSON.stringify(check.value),
        now,
      ),
      this.env.DB.prepare(
        "UPDATE cycle_zone_capacity SET allocated=allocated+1, version=version+1 WHERE cycle_id=? AND zone_id=? AND location_id=? AND allocated < capacity",
      ).bind(input.cycleId, routing.zone_id, routing.location_id),
      this.env.DB.prepare(
        "INSERT INTO capacity_allocations (id, cycle_id, zone_id, location_id, checkout_attempt_id, units, status, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 1, 'HELD', ?, ? WHERE changes()=1",
      ).bind(
        allocationId,
        input.cycleId,
        routing.zone_id,
        routing.location_id,
        checkoutAttemptId,
        now,
        now,
      ),
    ];
    for (const [poolId, quantity] of holds) {
      if (quantity <= 0) continue;
      statements.push(
        this.env.DB.prepare(
          "UPDATE inventory_balance SET reserved=reserved+?, version=version+1 WHERE location_id=? AND inventory_pool_id=? AND on_hand-reserved>=?",
        ).bind(quantity, routing.location_id, poolId, quantity),
        this.env.DB.prepare(
          "INSERT INTO checkout_inventory_holds (id, checkout_attempt_id, inventory_pool_id, location_id, quantity, status, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 'HELD', ?, ? WHERE changes()=1",
        ).bind(
          crypto.randomUUID(),
          checkoutAttemptId,
          poolId,
          routing.location_id,
          quantity,
          now,
          now,
        ),
        this.env.DB.prepare(
          "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at) SELECT ?, ?, ?, 'CHECKOUT_HOLD', 0, ?, 'checkout_attempt', ?, 'CUSTOMER', 'CHECKOUT_COMMIT', '{}', ? WHERE changes()=1",
        ).bind(crypto.randomUUID(), poolId, routing.location_id, quantity, checkoutAttemptId, now),
      );
    }
    const guard =
      "(SELECT COUNT(*) FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD')=? AND EXISTS (SELECT 1 FROM capacity_allocations WHERE id=? AND status='HELD')";
    const guardArgs = [checkoutAttemptId, holdCount, allocationId];
    statements.push(
      this.env.DB.prepare(
        `INSERT INTO payment_attempt (id, customer_id, checkout_attempt_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 'SUCCEEDED', 'sandbox', ?, ?, ?, ? WHERE ${guard}`,
      ).bind(
        paymentId,
        customer.value.customerId,
        checkoutAttemptId,
        check.value.totalMinor,
        check.value.currency,
        `sandbox_${paymentId}`,
        input.idempotencyKey,
        now,
        now,
        ...guardArgs,
      ),
      this.env.DB.prepare(
        `INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) SELECT ?, ?, ?, ?, 'COMMITTED', ?, ?, ?, ? WHERE ${guard}`,
      ).bind(
        orderId,
        customer.value.customerId,
        input.cycleId,
        JSON.stringify(address),
        check.value.totalMinor,
        check.value.currency,
        paymentId,
        now,
        ...guardArgs,
      ),
      this.env.DB.prepare(
        `INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at) SELECT ?, ?, ?, 'PENDING', ? WHERE ${guard}`,
      ).bind(crypto.randomUUID(), orderId, routing.location_id, now, ...guardArgs),
      this.env.DB.prepare(
        `INSERT INTO delivery_job (id, order_id, cycle_id, status, address_snapshot_json) SELECT ?, ?, ?, 'PENDING', ? WHERE ${guard}`,
      ).bind(crypto.randomUUID(), orderId, input.cycleId, JSON.stringify(address), ...guardArgs),
      this.env.DB.prepare(
        `INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id, details_json, idempotency_key, occurred_at) SELECT ?, ?, 'ORDER_COMMITTED', 'grocery_order', ?, ?, ?, ? WHERE ${guard}`,
      ).bind(
        crypto.randomUUID(),
        customer.value.user.id,
        orderId,
        JSON.stringify({ totalMinor: check.value.totalMinor }),
        input.idempotencyKey,
        now,
        ...guardArgs,
      ),
      this.env.DB.prepare(
        `UPDATE idempotency_records SET result_reference=?, status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING' AND ${guard}`,
      ).bind(orderId, now, scope, input.idempotencyKey, hash, ...guardArgs),
      this.env.DB.prepare(
        `INSERT INTO payment_events (id, provider, provider_event_id, provider_reference, event_type, payload_hash, received_at, processed_at, processing_status) SELECT ?, 'sandbox', ?, ?, 'PAYMENT_SUCCEEDED', ?, ?, ?, 'PROCESSED' WHERE ${guard}`,
      ).bind(
        crypto.randomUUID(),
        `sandbox_event_${paymentId}`,
        `sandbox_${paymentId}`,
        hash,
        now,
        now,
        ...guardArgs,
      ),
    );
    for (const item of cart.results) {
      const line = item.quantity * item.unit_price_minor;
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
        ).bind(
          crypto.randomUUID(),
          orderId,
          item.sku_id,
          item.product_name,
          item.variant_name,
          item.unit,
          item.quantity,
          item.unit_price_minor,
          line,
          item.quantity * item.consumption_base_quantity,
          ...guardArgs,
        ),
      );
    }
    for (const plan of inventoryPlan.plans) {
      const poolId = plan.inventoryPoolId;
      const requestedBase = plan.requestedBase;
      const source = plan.sourcingMode;
      const reservedBase = holds.get(poolId) ?? 0;
      const plannedBase = source === "STOCKED" ? 0 : Math.max(0, requestedBase - reservedBase);
      if (reservedBase > 0)
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) SELECT ?, ?, ?, ?, ?, 'RESERVED' WHERE ${guard}`,
          ).bind(
            crypto.randomUUID(),
            orderId,
            routing.location_id,
            poolId,
            reservedBase,
            ...guardArgs,
          ),
        );
      if (plannedBase > 0)
        statements.push(
          this.env.DB.prepare(
            `INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status) SELECT ?, ?, ?, ?, ?, ?, 'OPEN' WHERE ${guard}`,
          ).bind(
            crypto.randomUUID(),
            orderId,
            input.cycleId,
            routing.location_id,
            poolId,
            plannedBase,
            ...guardArgs,
          ),
        );
    }
    statements.push(
      this.env.DB.prepare(
        `UPDATE checkout_attempts SET status='SUCCEEDED', version=version+1, updated_at=? WHERE id=? AND ${guard}`,
      ).bind(now, checkoutAttemptId, ...guardArgs),
      this.env.DB.prepare(
        "UPDATE capacity_allocations SET status='COMMITTED', order_id=?, updated_at=? WHERE id=? AND status='HELD' AND EXISTS (SELECT 1 FROM grocery_order WHERE id=?)",
      ).bind(orderId, now, allocationId, orderId),
      this.env.DB.prepare(
        "UPDATE checkout_inventory_holds SET status='COMMITTED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD' AND EXISTS (SELECT 1 FROM grocery_order WHERE id=?)",
      ).bind(now, checkoutAttemptId, orderId),
    );
    try {
      await this.env.DB.batch(statements);
    } catch {
      await this.env.DB.prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
        .bind(this.now(), scope, input.idempotencyKey)
        .run();
      const existing = await findIdempotencyRecord(this.env.DB, scope, input.idempotencyKey);
      if (existing?.requestHash !== hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (existing?.status === "SUCCEEDED" && existing.resultReference) {
        const old = await this.env.DB.prepare(
          "SELECT id,total_minor,currency FROM grocery_order WHERE id=?",
        )
          .bind(existing.resultReference)
          .first<{ id: string; total_minor: number; currency: string }>();
        if (old)
          return {
            ok: true as const,
            value: {
              orderId: old.id,
              paymentStatus: "SUCCEEDED" as const,
              orderStatus: "COMMITTED" as const,
              totalMinor: old.total_minor,
              currency: old.currency,
            },
            requestId: input.requestId,
          };
      }
      return fail(
        "CONFLICT",
        "The original checkout request could not be completed",
        input.requestId,
      );
    }
    const committed = await this.env.DB.prepare("SELECT id FROM grocery_order WHERE id=?")
      .bind(orderId)
      .first<{ id: string }>();
    if (!committed) {
      const heldAllocation = await this.env.DB.prepare(
        "SELECT id FROM capacity_allocations WHERE id=? AND status='HELD'",
      )
        .bind(allocationId)
        .first<{ id: string }>();
      const heldHolds = await this.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
      )
        .bind(checkoutAttemptId)
        .first<{ count: number }>();
      await this.env.DB.batch([
        this.env.DB.prepare(
          "UPDATE cycle_zone_capacity SET allocated=MAX(0, allocated-1), version=version+1 WHERE cycle_id=? AND zone_id=? AND location_id=? AND allocated>0 AND EXISTS (SELECT 1 FROM capacity_allocations WHERE id=? AND status='HELD')",
        ).bind(input.cycleId, routing.zone_id, routing.location_id, allocationId),
        this.env.DB.prepare(
          "UPDATE capacity_allocations SET status='RELEASED', updated_at=? WHERE id=?",
        ).bind(now, allocationId),
        this.env.DB.prepare(
          "UPDATE inventory_balance SET reserved=MAX(0, reserved-(SELECT COALESCE(SUM(quantity),0) FROM checkout_inventory_holds h WHERE h.checkout_attempt_id=? AND h.inventory_pool_id=inventory_balance.inventory_pool_id AND h.location_id=inventory_balance.location_id AND h.status='HELD'), version=version+1) WHERE EXISTS (SELECT 1 FROM checkout_inventory_holds h WHERE h.checkout_attempt_id=? AND h.status='HELD' AND h.inventory_pool_id=inventory_balance.inventory_pool_id AND h.location_id=inventory_balance.location_id)",
        ).bind(checkoutAttemptId, checkoutAttemptId),
        this.env.DB.prepare(
          "UPDATE checkout_inventory_holds SET status='RELEASED', updated_at=? WHERE checkout_attempt_id=? AND status='HELD'",
        ).bind(now, checkoutAttemptId),
        this.env.DB.prepare(
          "UPDATE checkout_attempts SET status='FAILED', version=version+1, updated_at=? WHERE id=?",
        ).bind(now, checkoutAttemptId),
        this.env.DB.prepare(
          "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        ).bind(now, scope, input.idempotencyKey),
      ]);
      return fail(
        heldAllocation && (heldHolds?.count ?? 0) < holdCount
          ? "INSUFFICIENT_STOCK"
          : "CAPACITY_UNAVAILABLE",
        "Checkout could not reserve required capacity or stock",
        input.requestId,
      );
    }
    return {
      ok: true as const,
      value: {
        orderId,
        paymentStatus: "SUCCEEDED" as const,
        orderStatus: "COMMITTED" as const,
        totalMinor: check.value.totalMinor,
        currency: check.value.currency,
      },
      requestId: input.requestId,
    };
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
  async advanceOrder(input: import("@freshmarkets/contracts").AdminOrderCommandRequest) {
    const validation = adminOrderCommandSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const row = await this.env.DB.prepare(
      "SELECT o.status, f.location_id FROM grocery_order o LEFT JOIN fulfillment_record f ON f.order_id=o.id WHERE o.id=?",
    )
      .bind(input.orderId)
      .first<{ status: string; location_id: string | null }>();
    if (!row) return fail("NOT_FOUND", "Order not found", input.requestId);
    const locationId =
      row.location_id ?? (await this.activeFulfillmentLocationId(await this.activeMarketCode()));
    if (!locationId)
      return fail(
        "CONFIGURATION_ERROR",
        "No active fulfillment location is configured",
        input.requestId,
      );
    if (!(await this.requireOperationalAccess(input, "order:manage", locationId)))
      return fail(
        "FORBIDDEN",
        "Order management capability and location scope are required",
        input.requestId,
      );
    if (
      financialOperationDisposition(input.action, row.status) === "REQUIRES_CANONICAL_ORCHESTRATION"
    )
      return fail(
        "FINANCIAL_OPERATION_REQUIRES_REVIEW",
        "Refunds and paid-order cancellation require canonical payment orchestration",
        input.requestId,
      );
    const operationScope = "orders.advance";
    const operationPayload = {
      orderId: input.orderId,
      action: input.action,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    };
    const idempotency = await this.claimCommandIdempotency(
      operationScope,
      input.idempotencyKey,
      operationPayload,
    );
    if (idempotency.existing) {
      if (idempotency.existing.requestHash !== idempotency.hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      if (idempotency.existing.status === "SUCCEEDED" && idempotency.existing.resultReference) {
        const prior = await this.env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
          .bind(idempotency.existing.resultReference)
          .first<{ status: string }>();
        if (prior)
          return {
            ok: true as const,
            value: { id: idempotency.existing.resultReference, status: prior.status },
            requestId: input.requestId,
          };
      }
      return fail("CONFLICT", "The original order command is still processing", input.requestId);
    }
    const transitionResult = this.transitionOrError(
      row.status,
      input.action === "CANCEL" ? "CANCELED" : "REFUNDED",
      orderTransitions,
      input.requestId,
    );
    if (!transitionResult.ok) return transitionResult;
    const next = transitionResult.value;
    const orderUpdate = this.env.DB.prepare(
      input.expectedVersion === undefined
        ? "UPDATE grocery_order SET status=?, version=version+1 WHERE id=? AND status=?"
        : "UPDATE grocery_order SET status=?, version=version+1 WHERE id=? AND status=? AND version=?",
    ).bind(
      ...(input.expectedVersion === undefined
        ? [next, input.orderId, row.status]
        : [next, input.orderId, row.status, input.expectedVersion]),
    );
    const statements: D1PreparedStatement[] = [
      orderUpdate,
      this.env.DB.prepare(
        "UPDATE idempotency_records SET result_reference=?, status='SUCCEEDED', updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING' AND changes()=1",
      ).bind(input.orderId, this.now(), operationScope, input.idempotencyKey, idempotency.hash),
      this.env.DB.prepare(
        "INSERT INTO audit_event (id, action, aggregate_type, aggregate_id, details_json, idempotency_key, occurred_at) SELECT ?, ?, 'grocery_order', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(
        crypto.randomUUID(),
        input.action,
        input.orderId,
        JSON.stringify({ reason: input.reason }),
        input.idempotencyKey,
        this.now(),
        operationScope,
        input.idempotencyKey,
      ),
    ];
    const batchResults = await this.env.DB.batch(statements);
    if ((batchResults[0]?.meta?.changes ?? 0) !== 1) {
      await this.env.DB.prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
        .bind(this.now(), operationScope, input.idempotencyKey)
        .run();
      return fail("STALE_VERSION", "Order changed; refresh before retrying", input.requestId);
    }
    return {
      ok: true as const,
      value: { id: input.orderId, status: next },
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
    const status =
      input.rejectedQuantity > 0
        ? input.acceptedQuantity > 0
          ? "PARTIALLY_RECEIVED"
          : "EXCEPTION"
        : "RECEIVED";
    const requirement = await this.env.DB.prepare(
      "SELECT location_id, inventory_pool_id, version FROM procurement_requirement WHERE id=?",
    )
      .bind(input.requirementId)
      .first<{ location_id: string; inventory_pool_id: string; version: number }>();
    if (!requirement)
      return fail("NOT_FOUND", "Procurement requirement not found", input.requestId);
    const receivingRecord = await this.env.DB.prepare(
      "SELECT id FROM receiving_record WHERE procurement_requirement_id=?",
    )
      .bind(input.requirementId)
      .first<{ id: string }>();
    if (!receivingRecord) return fail("NOT_FOUND", "Receiving record not found", input.requestId);
    if (
      !(await this.requireOperationalAccess(input, "procurement:manage", requirement.location_id))
    )
      return fail(
        "FORBIDDEN",
        "Procurement capability and location scope are required",
        input.requestId,
      );
    const scope = "procurement.receive";
    const idempotency = await this.claimCommandIdempotency(scope, input.idempotencyKey, {
      requirementId: input.requirementId,
      acceptedQuantity: input.acceptedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      reason: input.reason,
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
          value: { id: input.requirementId, status },
          requestId: input.requestId,
        };
      return fail(
        "CONFLICT",
        "The original receiving command is still processing",
        input.requestId,
      );
    }
    const receivingStatements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        input.expectedVersion === undefined
          ? "UPDATE procurement_requirement SET status=?, version=version+1 WHERE id=?"
          : "UPDATE procurement_requirement SET status=?, version=version+1 WHERE id=? AND version=?",
      ).bind(
        ...(input.expectedVersion === undefined
          ? [status, input.requirementId]
          : [status, input.requirementId, input.expectedVersion]),
      ),
      this.env.DB.prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING' AND changes()=1",
      ).bind(input.requirementId, this.now(), scope, input.idempotencyKey, idempotency.hash),
      this.env.DB.prepare(
        "UPDATE receiving_record SET accepted_quantity=?, rejected_quantity=?, status=?, version=version+1 WHERE procurement_requirement_id=? AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(
        input.acceptedQuantity,
        input.rejectedQuantity,
        status,
        input.requirementId,
        scope,
        input.idempotencyKey,
      ),
      this.env.DB.prepare(
        "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) SELECT ?, ?, ?, 0, 1 WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED') ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand, version=version+1",
      ).bind(
        requirement.location_id,
        requirement.inventory_pool_id,
        input.acceptedQuantity,
        scope,
        input.idempotencyKey,
      ),
      this.env.DB.prepare(
        "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at, idempotency_key) SELECT ?, ?, ?, 'RECEIVING_ACCEPTED', ?, 0, 'procurement_requirement', ?, 'STAFF', 'PROCUREMENT_RECEIPT', ?, ?, ? WHERE ?>0 AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(
        crypto.randomUUID(),
        requirement.inventory_pool_id,
        requirement.location_id,
        input.acceptedQuantity,
        input.requirementId,
        JSON.stringify({ rejectedQuantity: input.rejectedQuantity, reason: input.reason ?? null }),
        this.now(),
        input.idempotencyKey,
        input.acceptedQuantity,
        scope,
        input.idempotencyKey,
      ),
    ];
    if (input.rejectedQuantity > 0)
      receivingStatements.push(
        this.env.DB.prepare(
          "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at) SELECT ?, ?, 'QUALITY_REJECTION', ?, 'OPEN', ? WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
        ).bind(
          crypto.randomUUID(),
          input.requirementId,
          input.rejectedQuantity,
          this.now(),
          scope,
          input.idempotencyKey,
        ),
      );
    const receivingResults = await this.env.DB.batch(receivingStatements);
    if ((receivingResults[0]?.meta?.changes ?? 0) !== 1) {
      await this.env.DB.prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
        .bind(this.now(), scope, input.idempotencyKey)
        .run();
      return fail(
        "STALE_VERSION",
        "Procurement requirement changed; refresh before retrying",
        input.requestId,
      );
    }
    return {
      ok: true as const,
      value: { id: input.requirementId, status },
      requestId: input.requestId,
    };
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
      input.expectedVersion === undefined
        ? "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=?"
        : "UPDATE fulfillment_record SET status=?, updated_at=?, version=version+1 WHERE order_id=? AND version=?",
    )
      .bind(
        ...(input.expectedVersion === undefined
          ? [next, this.now(), input.orderId]
          : [next, this.now(), input.orderId, input.expectedVersion]),
      )
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
    const deliveryUpdate =
      input.expectedVersion === undefined
        ? this.env.DB.prepare(
            "UPDATE delivery_job SET status=?, delivered_at=?, version=version+1 WHERE order_id=?",
          ).bind(next, next === "DELIVERED" ? this.now() : null, input.orderId)
        : this.env.DB.prepare(
            "UPDATE delivery_job SET status=?, delivered_at=?, version=version+1 WHERE order_id=? AND version=?",
          ).bind(
            next,
            next === "DELIVERED" ? this.now() : null,
            input.orderId,
            input.expectedVersion,
          );
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
