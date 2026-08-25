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
import {
  DEFAULT_FULFILLMENT_LOCATION_ID,
  DEFAULT_MARKET_CODE,
  DEFAULT_MINIMUM_BASKET_MINOR,
  DEFAULT_SUBSCRIPTION_OFFER_CODE,
  runtimeEnvironment,
} from "@freshmarkets/config";
import { systemClock, type Clock } from "@freshmarkets/domain-shared";
import {
  addressRequestSchema,
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
import { buildInventoryCommitPlan } from "./commerce/inventory-plan";
import { drizzle } from "drizzle-orm/d1";
import { log, requestId } from "./observability";
import { applicationContext, hasOperationalScope } from "./auth/authorization";
import { createAuth, type AuthEnvironment } from "./auth/service";
import { authSchema } from "./auth/schema";
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
      drizzle(this.env.DB, { schema: authSchema }),
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
  private async customer(input: AuthenticatedRequest, create = true) {
    const user = await this.session(input);
    if (!user) return null;
    let row = await this.env.DB.prepare(
      "SELECT id, auth_user_id FROM customer WHERE auth_user_id=?",
    )
      .bind(user.id)
      .first<{ id: string; auth_user_id: string }>();
    if (!row && create) {
      const id = crypto.randomUUID();
      await this.env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      )
        .bind(id, user.id, this.now(), this.now())
        .run();
      row = { id, auth_user_id: user.id };
    }
    return row ? { ...row, user } : null;
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
    if (existing) return { hash, existing, claimed: false };
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
    const customer = await this.customer(input);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const geo = await resolveServiceability(drizzle(this.env.DB), input);
    if (!geo.ok) return { ok: false as const, error: geo.error };
    const id = crypto.randomUUID();
    const now = this.now();
    await this.env.DB.prepare(
      "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, resolution_version, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    )
      .bind(
        id,
        customer.id,
        input.label,
        input.recipient,
        input.phone,
        input.addressJson,
        input.latitude,
        input.longitude,
        geo.value.serviceArea?.code ?? null,
        geo.value.deliveryZone?.code ?? null,
        geo.value.serviceArea?.polygonVersion ?? null,
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
        serviceAreaCode: geo.value.serviceArea?.code ?? null,
        deliveryZoneCode: geo.value.deliveryZone?.code ?? null,
        resolutionVersion: geo.value.serviceArea?.polygonVersion ?? null,
      },
      requestId: input.requestId,
    };
  }
  async startTrial(input: import("@freshmarkets/contracts").StartTrialRequest) {
    const validation = authenticatedRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.customer(input);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const existing = await this.env.DB.prepare(
      "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(customer.id)
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
      "SELECT id, trial_days FROM subscription_offer WHERE code=? AND status='active'",
    )
      .bind(input.offerCode ?? DEFAULT_SUBSCRIPTION_OFFER_CODE)
      .first<{ id: string; trial_days: number }>();
    if (!offer) return fail("NOT_FOUND", "Subscription offer not found", input.requestId);
    const now = this.now();
    const trialEnds = now + offer.trial_days * 86400000;
    const subscriptionId = crypto.randomUUID();
    await this.env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES (?, ?, ?, 'TRIALING', ?, ?, ?, ?)",
    )
      .bind(subscriptionId, customer.id, offer.id, now, trialEnds, now, now)
      .run();
    await this.env.DB.prepare(
      "INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id, details_json, occurred_at) VALUES (?, ?, 'TRIAL_STARTED', 'subscription', ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        customer.user.id,
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
    const customer = await this.customer(input, false);
    const row = customer
      ? await this.env.DB.prepare(
          "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
        )
          .bind(customer.id)
          .first<{ status: string; trial_ends_at: number | null }>()
      : null;
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
    const rows = await this.env.DB.prepare(
      "SELECT dc.id, dc.name, dc.cutoff_at, dc.delivery_date, dc.status, COALESCE((SELECT MIN(czc.capacity-czc.allocated) FROM cycle_zone_capacity czc WHERE czc.cycle_id=dc.id), dc.capacity-dc.allocated) AS capacity_remaining FROM delivery_cycle dc JOIN market m ON m.id=dc.market_id WHERE m.code=COALESCE(?, ?) ORDER BY dc.delivery_date",
    )
      .bind(input.marketCode ?? null, DEFAULT_MARKET_CODE)
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
    const customer = await this.customer(input);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    let cart = await this.env.DB.prepare(
      "SELECT id, version FROM cart WHERE customer_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(customer.id)
      .first<{ id: string; version: number }>();
    if (!cart) {
      cart = { id: crypto.randomUUID(), version: 1 };
      await this.env.DB.prepare(
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)",
      )
        .bind(cart.id, customer.id, DEFAULT_FULFILLMENT_LOCATION_ID, this.now(), this.now())
        .run();
    }
    const rows = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name, COALESCE((SELECT amount_minor FROM price_version pv WHERE pv.sku_id=s.id AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1),0) AS unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id WHERE ci.cart_id=? ORDER BY s.sort_order",
    )
      .bind(this.now(), this.now(), cart.id)
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
        currency: "PHP",
      },
      requestId: input.requestId,
    };
  }
  async setCartItem(input: import("@freshmarkets/contracts").SetCartItemRequest) {
    const validation = setCartItemRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const customer = await this.customer(input);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
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
    const customer = await this.customer(input, false);
    if (!customer)
      return {
        ok: true as const,
        value: { eligible: false, failures: ["UNAUTHENTICATED"], totalMinor: 0, currency: "PHP" },
        requestId: input.requestId,
      };
    const [subscription, address, cycle, cart, policy] = await Promise.all([
      this.env.DB.prepare(
        "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
      )
        .bind(customer.id)
        .first<{ status: string; trial_ends_at: number | null }>(),
      this.env.DB.prepare(
        "SELECT latitude, longitude, delivery_zone_code FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
        .bind(input.addressId, customer.id)
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
        "SELECT c.id, COALESCE(SUM(ci.quantity * COALESCE((SELECT amount_minor FROM price_version pv WHERE pv.sku_id=ci.sku_id AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1),0)),0) AS total_minor FROM cart c LEFT JOIN cart_item ci ON ci.cart_id=c.id WHERE c.id=? AND c.customer_id=? GROUP BY c.id",
      )
        .bind(this.now(), this.now(), input.cartId, customer.id)
        .first<{ id: string; total_minor: number }>(),
      this.env.DB.prepare(
        "SELECT mcp.minimum_basket_minor, mcp.currency FROM delivery_cycle dc JOIN market_commerce_policy mcp ON mcp.market_id=dc.market_id WHERE dc.id=?",
      )
        .bind(input.cycleId)
        .first<{ minimum_basket_minor: number; currency: string }>(),
    ]);
    const geo = address
      ? await resolveServiceability(drizzle(this.env.DB), {
          requestId: input.requestId,
          latitude: address.latitude,
          longitude: address.longitude,
        })
      : null;
    const zoneCapacity = address?.delivery_zone_code
      ? await this.env.DB.prepare(
          "SELECT MIN(czc.capacity-czc.allocated) AS remaining FROM cycle_zone_capacity czc JOIN delivery_zone dz ON dz.id=czc.zone_id WHERE czc.cycle_id=? AND dz.code=?",
        )
          .bind(input.cycleId, address.delivery_zone_code)
          .first<{ remaining: number | null }>()
      : null;
    const eligibility = checkoutEligibility(
      {
        requestId: input.requestId,
        latitude: address?.latitude ?? 0,
        longitude: address?.longitude ?? 0,
        customerId: customer.id,
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
    if (!cycle || cycle.status !== "OPEN" || cycle.cutoff_at <= this.now())
      failures.push("CYCLE_CLOSED");
    if (zoneCapacity?.remaining !== null && zoneCapacity?.remaining !== undefined) {
      if (zoneCapacity.remaining <= 0) failures.push("CYCLE_FULL");
    } else if (cycle && cycle.allocated >= cycle.capacity) failures.push("CYCLE_FULL");
    if (!cart || cart.total_minor < (policy?.minimum_basket_minor ?? DEFAULT_MINIMUM_BASKET_MINOR))
      failures.push("MINIMUM_ORDER_NOT_MET");
    return {
      ok: true as const,
      value: {
        eligible: failures.length === 0,
        failures,
        totalMinor: cart?.total_minor ?? 0,
        currency: "PHP",
      },
      requestId: input.requestId,
    };
  }

  async commitMockOrder(input: import("@freshmarkets/contracts").CommitMockOrderRequest) {
    const validation = commitOrderRequestSchema.safeParse(input);
    if (!validation.success)
      return fail("VALIDATION_FAILED", validationMessage(validation.error), input.requestId);
    const scope = "checkout.commitMockOrder";
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
      return fail("CONFLICT", "The original request is still processing", input.requestId);
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
    const customer = await this.customer(input, false);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const address = await this.env.DB.prepare(
      "SELECT * FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
    )
      .bind(input.addressId, customer.id)
      .first<Record<string, any>>();
    if (!address) return fail("NOT_FOUND", "Customer address not found", input.requestId);
    const routing = await this.env.DB.prepare(
      "SELECT dz.id zone_id, ls.location_id FROM delivery_zone dz JOIN location_serviceability ls ON ls.zone_id=dz.id AND ls.eligible=1 WHERE dz.code=? AND dz.status='active' ORDER BY ls.priority LIMIT 1",
    )
      .bind(address.delivery_zone_code)
      .first<{ zone_id: string; location_id: string }>();
    if (!routing)
      return fail(
        "ADDRESS_NOT_SERVICEABLE",
        "Address has no eligible fulfillment location",
        input.requestId,
      );
    const cart = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name variant_name, p.name product_name, u.symbol unit, s.consumption_base_quantity, p.inventory_pool_id, ip.sourcing_mode, COALESCE((SELECT amount_minor FROM price_version pv WHERE pv.sku_id=s.id AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1),0) unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id JOIN unit u ON u.id=s.sellable_unit_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE ci.cart_id=?",
    )
      .bind(this.now(), this.now(), input.cartId)
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
        "INSERT INTO checkout_attempts (id, customer_id, cart_id, address_id, cycle_id, zone_id, location_id, status, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, 1, ?, ?)",
      ).bind(
        checkoutAttemptId,
        customer.id,
        input.cartId,
        input.addressId,
        input.cycleId,
        routing.zone_id,
        routing.location_id,
        input.idempotencyKey,
        now,
        now,
      ),
      this.env.DB.prepare(
        "INSERT INTO checkout_quote_snapshots (id, checkout_attempt_id, merchandise_minor, total_minor, currency, item_snapshot_json, eligibility_snapshot_json, created_at) VALUES (?, ?, ?, ?, 'PHP', ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        checkoutAttemptId,
        check.value.totalMinor,
        check.value.totalMinor,
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
        `INSERT INTO payment_attempt (id, customer_id, checkout_attempt_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) SELECT ?, ?, ?, ?, 'PHP', 'SUCCEEDED', 'sandbox', ?, ?, ?, ? WHERE ${guard}`,
      ).bind(
        paymentId,
        customer.id,
        checkoutAttemptId,
        check.value.totalMinor,
        `sandbox_${paymentId}`,
        input.idempotencyKey,
        now,
        now,
        ...guardArgs,
      ),
      this.env.DB.prepare(
        `INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) SELECT ?, ?, ?, ?, 'COMMITTED', ?, 'PHP', ?, ? WHERE ${guard}`,
      ).bind(
        orderId,
        customer.id,
        input.cycleId,
        JSON.stringify(address),
        check.value.totalMinor,
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
        customer.user.id,
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
        currency: "PHP",
      },
      requestId: input.requestId,
    };
  }

  async listCustomerOrders(input: AuthenticatedRequest) {
    const customer = await this.customer(input, false);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const rows = await this.env.DB.prepare(
      "SELECT o.id,o.status,c.delivery_date,o.total_minor,o.currency,(SELECT COUNT(*) FROM order_item oi WHERE oi.order_id=o.id) item_count FROM grocery_order o JOIN delivery_cycle c ON c.id=o.cycle_id WHERE o.customer_id=? ORDER BY o.created_at DESC",
    )
      .bind(customer.id)
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
    const row = await this.env.DB.prepare(
      "SELECT o.status, f.location_id FROM grocery_order o LEFT JOIN fulfillment_record f ON f.order_id=o.id WHERE o.id=?",
    )
      .bind(input.orderId)
      .first<{ status: string; location_id: string | null }>();
    if (!row) return fail("NOT_FOUND", "Order not found", input.requestId);
    const locationId = row.location_id ?? DEFAULT_FULFILLMENT_LOCATION_ID;
    if (!(await this.requireOperationalAccess(input, "order:manage", locationId)))
      return fail(
        "FORBIDDEN",
        "Order management capability and location scope are required",
        input.requestId,
      );
    const transitionResult = this.transitionOrError(
      row.status,
      input.action === "CANCEL" ? "CANCELED" : "REFUNDED",
      orderTransitions,
      input.requestId,
    );
    if (!transitionResult.ok) return transitionResult;
    const next = transitionResult.value;
    const orderContext = await this.env.DB.prepare(
      "SELECT cycle_id, payment_id, total_minor, currency FROM grocery_order WHERE id=?",
    )
      .bind(input.orderId)
      .first<{ cycle_id: string; payment_id: string; total_minor: number; currency: string }>();
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
      this.env.DB.prepare(
        "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, reason_code, metadata_json, created_at) SELECT lower(hex(randomblob(16))), r.inventory_pool_id, r.location_id, 'RESERVATION_RELEASE', 0, -SUM(r.quantity), 'grocery_order', r.order_id, 'STAFF', 'ORDER_CANCELLATION', '{}', ? FROM inventory_reservation r WHERE r.order_id=? AND r.status='RESERVED' AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED') GROUP BY r.inventory_pool_id, r.location_id, r.order_id",
      ).bind(this.now(), input.orderId, operationScope, input.idempotencyKey),
      this.env.DB.prepare(
        "UPDATE inventory_balance SET reserved=MAX(0,reserved-(SELECT COALESCE(SUM(quantity),0) FROM inventory_reservation r WHERE r.order_id=? AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id AND r.status='RESERVED')), version=version+1 WHERE EXISTS (SELECT 1 FROM inventory_reservation r WHERE r.order_id=? AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id AND r.status='RESERVED') AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(input.orderId, input.orderId, operationScope, input.idempotencyKey),
      this.env.DB.prepare(
        "UPDATE inventory_reservation SET status='RELEASED', version=version+1 WHERE order_id=? AND status='RESERVED' AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(input.orderId, operationScope, input.idempotencyKey),
      this.env.DB.prepare(
        "UPDATE committed_demand SET status='CANCELED', version=version+1 WHERE order_id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
      ).bind(input.orderId, operationScope, input.idempotencyKey),
    ];
    if (orderContext)
      statements.push(
        this.env.DB.prepare(
          "UPDATE cycle_zone_capacity SET allocated=MAX(0,allocated-1), version=version+1 WHERE EXISTS (SELECT 1 FROM capacity_allocations ca WHERE ca.order_id=? AND ca.cycle_id=cycle_zone_capacity.cycle_id AND ca.zone_id=cycle_zone_capacity.zone_id AND ca.location_id=cycle_zone_capacity.location_id AND ca.status='COMMITTED') AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
        ).bind(input.orderId, operationScope, input.idempotencyKey),
        this.env.DB.prepare(
          "UPDATE capacity_allocations SET status='RELEASED', updated_at=? WHERE order_id=? AND status='COMMITTED' AND EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
        ).bind(this.now(), input.orderId, operationScope, input.idempotencyKey),
      );
    if (input.action === "REFUND" && orderContext)
      statements.push(
        this.env.DB.prepare(
          "INSERT INTO refund (id, payment_id, order_id, amount_minor, currency, status, reason, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?, ? WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND status='SUCCEEDED')",
        ).bind(
          crypto.randomUUID(),
          orderContext.payment_id,
          input.orderId,
          orderContext.total_minor,
          orderContext.currency,
          input.reason,
          this.now(),
          this.now(),
          operationScope,
          input.idempotencyKey,
        ),
      );
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
    const scope = "inventory.adjust";
    const hash = await requestHash({
      locationId: input.locationId,
      inventoryPoolId: input.inventoryPoolId,
      delta: input.delta,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    });
    const replay = await findIdempotencyRecord(this.env.DB, scope, input.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== hash)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          input.requestId,
        );
      return replay.status === "SUCCEEDED"
        ? {
            ok: true as const,
            value: { id: `${input.locationId}:${input.inventoryPoolId}`, status: "ADJUSTED" },
            requestId: input.requestId,
          }
        : fail("CONFLICT", "The original inventory command is still processing", input.requestId);
    }
    const result = await this.env.DB.prepare(
      input.expectedVersion === undefined
        ? "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES (?, ?, ?, 0, 1) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand, version=version+1"
        : "UPDATE inventory_balance SET on_hand=on_hand+?, version=version+1 WHERE location_id=? AND inventory_pool_id=? AND version=?",
    )
      .bind(
        ...(input.expectedVersion === undefined
          ? [input.locationId, input.inventoryPoolId, input.delta]
          : [input.delta, input.locationId, input.inventoryPoolId, input.expectedVersion]),
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      return fail("STALE_VERSION", "Inventory changed; refresh before retrying", input.requestId);
    const now = this.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO inventory_ledger_entries (id, inventory_pool_id, location_id, movement_type, quantity_delta_base, reservation_delta_base, reference_type, reference_id, actor_type, actor_id, reason_code, metadata_json, created_at, idempotency_key) VALUES (?, ?, ?, 'MANUAL_ADJUSTMENT', ?, 0, 'inventory_balance', ?, 'STAFF', ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        input.inventoryPoolId,
        input.locationId,
        input.delta,
        `${input.locationId}:${input.inventoryPoolId}`,
        input.headers["x-user-id"] ?? null,
        input.reason,
        JSON.stringify({ requestId: input.requestId }),
        now,
        input.idempotencyKey,
      ),
      this.env.DB.prepare(
        "INSERT INTO idempotency_records (scope, idempotency_key, request_hash, result_type, result_reference, status, created_at, updated_at) VALUES (?, ?, ?, 'inventory_balance', ?, 'SUCCEEDED', ?, ?)",
      ).bind(
        scope,
        input.idempotencyKey,
        hash,
        `${input.locationId}:${input.inventoryPoolId}`,
        now,
        now,
      ),
    ]);
    return {
      ok: true as const,
      value: { id: `${input.locationId}:${input.inventoryPoolId}`, status: "ADJUSTED" },
      requestId: input.requestId,
    };
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
    if (
      !(await this.requireOperationalAccess(
        input,
        "delivery:manage",
        row.location_id ?? DEFAULT_FULFILLMENT_LOCATION_ID,
      ))
    )
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
