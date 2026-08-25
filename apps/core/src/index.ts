import { WorkerEntrypoint } from "cloudflare:workers";
import {
  CONTRACT_VERSION,
  type AuthContextRequest,
  type AuthRequest,
  type AuthResponse,
  type AuthenticatedRequest,
  type CoreHealthResponse,
  type RequestMeta,
} from "@freshmarkets/contracts";
import { runtimeEnvironment } from "@freshmarkets/config";
import { drizzle } from "drizzle-orm/d1";
import { log, requestId } from "./observability";
import { applicationContext } from "./auth/authorization";
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
    return {
      ok: true as const,
      value: await resolveServiceability(drizzle(this.env.DB), input),
      requestId: input.requestId,
    };
  }
  async searchCatalog(input: import("@freshmarkets/contracts").CatalogSearchRequest) {
    return {
      ok: true as const,
      value: await searchCatalog(drizzle(this.env.DB), input),
      requestId: input.requestId,
    };
  }
  async getCatalogProduct(input: import("@freshmarkets/contracts").CatalogProductRequest) {
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
        .bind(id, user.id, Date.now(), Date.now())
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
    return Boolean(
      context.ok && context.value.authenticated && context.value.capabilities.includes(capability),
    );
  }

  async createCustomerAddress(
    input: import("@freshmarkets/contracts").CreateCustomerAddressRequest,
  ) {
    const customer = await this.customer(input);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const geo = await resolveServiceability(drizzle(this.env.DB), input);
    if (!geo.ok) return { ok: false as const, error: geo.error };
    const id = crypto.randomUUID();
    const now = Date.now();
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
    const now = Date.now();
    const trialEnds = now + 14 * 86400000;
    await this.env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES (?, ?, 'offer-trial', 'TRIALING', ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), customer.id, now, trialEnds, now, now)
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
      (!row.trial_ends_at || row.trial_ends_at > Date.now()),
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
      "SELECT dc.id, dc.name, dc.cutoff_at, dc.delivery_date, dc.status, dc.capacity-dc.allocated AS capacity_remaining FROM delivery_cycle dc JOIN market m ON m.id=dc.market_id WHERE m.code=COALESCE(?, 'METRO_CEBU') ORDER BY dc.delivery_date",
    )
      .bind(input.marketCode ?? null)
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
        "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'ACTIVE', 1, ?, ?)",
      )
        .bind(cart.id, customer.id, Date.now(), Date.now())
        .run();
    }
    const rows = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name, COALESCE((SELECT amount_minor FROM price_version pv WHERE pv.sku_id=s.id AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1),0) AS unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id WHERE ci.cart_id=? ORDER BY s.sort_order",
    )
      .bind(Date.now(), Date.now(), cart.id)
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
        Date.now(),
        current.value.id,
      ),
    ]);
    return this.getCart(input);
  }

  async evaluateCheckout(input: import("@freshmarkets/contracts").CheckoutEligibilityRequest) {
    const customer = await this.customer(input, false);
    if (!customer)
      return {
        ok: true as const,
        value: { eligible: false, failures: ["UNAUTHENTICATED"], totalMinor: 0, currency: "PHP" },
        requestId: input.requestId,
      };
    const [subscription, address, cycle, cart] = await Promise.all([
      this.env.DB.prepare(
        "SELECT status, trial_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
      )
        .bind(customer.id)
        .first<{ status: string; trial_ends_at: number | null }>(),
      this.env.DB.prepare(
        "SELECT latitude, longitude FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
      )
        .bind(input.addressId, customer.id)
        .first<{ latitude: number; longitude: number }>(),
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
        .bind(Date.now(), Date.now(), input.cartId, customer.id)
        .first<{ id: string; total_minor: number }>(),
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
        customerId: customer.id,
        hasEligibleSubscription: Boolean(
          subscription &&
          ["ACTIVE", "TRIALING"].includes(subscription.status) &&
          (!subscription.trial_ends_at || subscription.trial_ends_at > Date.now()),
        ),
      },
      Boolean(geo?.ok && geo.value.serviceable),
    );
    const failures = [...eligibility.failures];
    if (!address) failures.push("ADDRESS_REQUIRED");
    if (!cycle || cycle.status !== "OPEN" || cycle.cutoff_at <= Date.now())
      failures.push("CYCLE_CLOSED");
    if (cycle && cycle.allocated >= cycle.capacity) failures.push("CYCLE_FULL");
    if (!cart || cart.total_minor < 50000) failures.push("MINIMUM_ORDER_NOT_MET");
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
    if (!check.value.eligible)
      return fail("VALIDATION_FAILED", check.value.failures.join(","), input.requestId);
    const customer = await this.customer(input, false);
    if (!customer) return fail("UNAUTHENTICATED", "Authentication is required", input.requestId);
    const address = await this.env.DB.prepare(
      "SELECT * FROM customer_address WHERE id=? AND customer_id=?",
    )
      .bind(input.addressId, customer.id)
      .first<Record<string, unknown>>();
    const cart = await this.env.DB.prepare(
      "SELECT ci.sku_id, ci.quantity, s.name variant_name, p.name product_name, u.symbol unit, s.consumption_base_quantity, p.inventory_pool_id, ip.sourcing_mode, COALESCE((SELECT amount_minor FROM price_version pv WHERE pv.sku_id=s.id AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1),0) unit_price_minor FROM cart_item ci JOIN sku s ON s.id=ci.sku_id JOIN product p ON p.id=s.product_id JOIN unit u ON u.id=s.sellable_unit_id JOIN inventory_pool ip ON ip.id=p.inventory_pool_id WHERE ci.cart_id=?",
    )
      .bind(Date.now(), Date.now(), input.cartId)
      .all<Record<string, any>>();
    const orderId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'PHP', 'SUCCEEDED', 'sandbox', ?, ?, ?, ?)",
      ).bind(
        paymentId,
        customer.id,
        check.value.totalMinor,
        `sandbox_${paymentId}`,
        input.idempotencyKey,
        now,
        now,
      ),
      this.env.DB.prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) VALUES (?, ?, ?, ?, 'COMMITTED', ?, 'PHP', ?, ?)",
      ).bind(
        orderId,
        customer.id,
        input.cycleId,
        JSON.stringify(address),
        check.value.totalMinor,
        paymentId,
        now,
      ),
      this.env.DB.prepare(
        "INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at) VALUES (?, ?, 'location-cebu-central', 'PENDING', ?)",
      ).bind(crypto.randomUUID(), orderId, now),
      this.env.DB.prepare(
        "INSERT INTO delivery_job (id, order_id, cycle_id, status, address_snapshot_json) VALUES (?, ?, ?, 'PENDING', ?)",
      ).bind(crypto.randomUUID(), orderId, input.cycleId, JSON.stringify(address)),
      this.env.DB.prepare(
        "INSERT INTO audit_event (id, actor_user_id, action, aggregate_type, aggregate_id, details_json, idempotency_key, occurred_at) VALUES (?, ?, 'ORDER_COMMITTED', 'grocery_order', ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        customer.user.id,
        orderId,
        JSON.stringify({ totalMinor: check.value.totalMinor }),
        input.idempotencyKey,
        now,
      ),
    ];
    for (const item of cart.results) {
      const line = item.quantity * item.unit_price_minor;
      const requestedBase = item.quantity * item.consumption_base_quantity;
      statements.push(
        this.env.DB.prepare(
          "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        ),
      );
      const balance = await this.env.DB.prepare(
        "SELECT on_hand, reserved FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id=?",
      )
        .bind(item.inventory_pool_id)
        .first<{ on_hand: number; reserved: number }>();
      const availableBase = Math.max(0, (balance?.on_hand ?? 0) - (balance?.reserved ?? 0));
      const reservedBase =
        item.sourcing_mode === "PLANNED_PROCUREMENT" ? 0 : Math.min(requestedBase, availableBase);
      const plannedBase =
        item.sourcing_mode === "STOCKED" ? 0 : Math.max(0, requestedBase - reservedBase);
      if (reservedBase > 0)
        statements.push(
          this.env.DB.prepare(
            "INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, 'location-cebu-central', ?, ?, 'RESERVED')",
          ).bind(crypto.randomUUID(), orderId, item.inventory_pool_id, reservedBase),
        );
      if (plannedBase > 0)
        statements.push(
          this.env.DB.prepare(
            "INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, ?, 'location-cebu-central', ?, ?, 'OPEN')",
          ).bind(crypto.randomUUID(), orderId, input.cycleId, item.inventory_pool_id, plannedBase),
        );
    }
    await this.env.DB.batch(statements);
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
    if (!(await this.requireCapability(input, "order:manage")))
      return fail("FORBIDDEN", "Order management capability is required", input.requestId);
    const row = await this.env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
      .bind(input.orderId)
      .first<{ status: string }>();
    if (!row) return fail("NOT_FOUND", "Order not found", input.requestId);
    const next = transition(
      row.status,
      input.action === "CANCEL" ? "CANCELED" : "REFUNDED",
      orderTransitions,
    );
    const orderContext = await this.env.DB.prepare(
      "SELECT cycle_id, payment_id, total_minor, currency FROM grocery_order WHERE id=?",
    )
      .bind(input.orderId)
      .first<{ cycle_id: string; payment_id: string; total_minor: number; currency: string }>();
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare("UPDATE grocery_order SET status=? WHERE id=?").bind(next, input.orderId),
      this.env.DB.prepare(
        "INSERT INTO audit_event (id, action, aggregate_type, aggregate_id, details_json, idempotency_key, occurred_at) VALUES (?, ?, 'grocery_order', ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        input.action,
        input.orderId,
        JSON.stringify({ reason: input.reason }),
        input.idempotencyKey,
        Date.now(),
      ),
      this.env.DB.prepare(
        "UPDATE inventory_balance SET reserved=MAX(0,reserved-(SELECT COALESCE(SUM(quantity),0) FROM inventory_reservation r WHERE r.order_id=? AND r.location_id=inventory_balance.location_id AND r.inventory_pool_id=inventory_balance.inventory_pool_id AND r.status='RESERVED'))",
      ).bind(input.orderId),
      this.env.DB.prepare(
        "UPDATE inventory_reservation SET status='RELEASED' WHERE order_id=? AND status='RESERVED'",
      ).bind(input.orderId),
      this.env.DB.prepare(
        "UPDATE committed_demand SET status='CANCELED' WHERE order_id=? AND status='OPEN'",
      ).bind(input.orderId),
    ];
    if (orderContext)
      statements.push(
        this.env.DB.prepare(
          "UPDATE delivery_cycle SET allocated=MAX(0,allocated-1), version=version+1 WHERE id=?",
        ).bind(orderContext.cycle_id),
      );
    if (input.action === "REFUND" && orderContext)
      statements.push(
        this.env.DB.prepare(
          "INSERT INTO refund (id, payment_id, order_id, amount_minor, currency, status, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?)",
        ).bind(
          crypto.randomUUID(),
          orderContext.payment_id,
          input.orderId,
          orderContext.total_minor,
          orderContext.currency,
          input.reason,
          Date.now(),
          Date.now(),
        ),
      );
    await this.env.DB.batch(statements);
    return {
      ok: true as const,
      value: { id: input.orderId, status: next },
      requestId: input.requestId,
    };
  }
  async adjustInventory(input: import("@freshmarkets/contracts").InventoryAdjustmentRequest) {
    if (!(await this.requireCapability(input, "inventory:manage")))
      return fail("FORBIDDEN", "Inventory management capability is required", input.requestId);
    await this.env.DB.prepare(
      "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES (?, ?, ?, 0) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand",
    )
      .bind(input.locationId, input.inventoryPoolId, input.delta)
      .run();
    return {
      ok: true as const,
      value: { id: `${input.locationId}:${input.inventoryPoolId}`, status: "ADJUSTED" },
      requestId: input.requestId,
    };
  }
  async createProcurementRequirement(
    input: import("@freshmarkets/contracts").ProcurementCommandRequest,
  ) {
    if (!(await this.requireCapability(input, "procurement:manage")))
      return fail("FORBIDDEN", "Procurement management capability is required", input.requestId);
    const id = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status) VALUES (?, ?, ?, ?, ?, 'DRAFT')",
      ).bind(id, input.deliveryCycleId, input.locationId, input.inventoryPoolId, input.quantity),
      this.env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status) VALUES (?, ?, ?, 0, 0, 'PENDING')",
      ).bind(crypto.randomUUID(), id, input.quantity),
    ]);
    return { ok: true as const, value: { id, status: "DRAFT" }, requestId: input.requestId };
  }
  async receiveProcurement(input: import("@freshmarkets/contracts").ReceivingCommandRequest) {
    if (!(await this.requireCapability(input, "procurement:manage")))
      return fail("FORBIDDEN", "Procurement management capability is required", input.requestId);
    const status =
      input.rejectedQuantity > 0
        ? input.acceptedQuantity > 0
          ? "PARTIALLY_RECEIVED"
          : "EXCEPTION"
        : "RECEIVED";
    const requirement = await this.env.DB.prepare(
      "SELECT location_id, inventory_pool_id FROM procurement_requirement WHERE id=?",
    )
      .bind(input.requirementId)
      .first<{ location_id: string; inventory_pool_id: string }>();
    if (!requirement)
      return fail("NOT_FOUND", "Procurement requirement not found", input.requestId);
    const receivingStatements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE receiving_record SET accepted_quantity=?, rejected_quantity=?, status=? WHERE procurement_requirement_id=?",
      ).bind(input.acceptedQuantity, input.rejectedQuantity, status, input.requirementId),
      this.env.DB.prepare("UPDATE procurement_requirement SET status=? WHERE id=?").bind(
        status,
        input.requirementId,
      ),
      this.env.DB.prepare(
        "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES (?, ?, ?, 0) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=on_hand+excluded.on_hand",
      ).bind(requirement.location_id, requirement.inventory_pool_id, input.acceptedQuantity),
    ];
    if (input.rejectedQuantity > 0)
      receivingStatements.push(
        this.env.DB.prepare(
          "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at) VALUES (?, ?, 'QUALITY_REJECTION', ?, 'OPEN', ?)",
        ).bind(crypto.randomUUID(), input.requirementId, input.rejectedQuantity, Date.now()),
      );
    await this.env.DB.batch(receivingStatements);
    return {
      ok: true as const,
      value: { id: input.requirementId, status },
      requestId: input.requestId,
    };
  }
  async advanceFulfillment(input: import("@freshmarkets/contracts").FulfillmentCommandRequest) {
    if (!(await this.requireCapability(input, "fulfillment:manage")))
      return fail("FORBIDDEN", "Fulfillment management capability is required", input.requestId);
    const row = await this.env.DB.prepare("SELECT status FROM fulfillment_record WHERE order_id=?")
      .bind(input.orderId)
      .first<{ status: string }>();
    if (!row) return fail("NOT_FOUND", "Fulfillment record not found", input.requestId);
    const next = transition(
      row.status,
      input.action === "START" ? "PICKING" : input.action === "PACK" ? "PACKED" : "SHORTAGE",
      fulfillmentTransitions,
    );
    await this.env.DB.prepare(
      "UPDATE fulfillment_record SET status=?, updated_at=? WHERE order_id=?",
    )
      .bind(next, Date.now(), input.orderId)
      .run();
    return {
      ok: true as const,
      value: { id: input.orderId, status: next },
      requestId: input.requestId,
    };
  }
  async advanceDelivery(input: import("@freshmarkets/contracts").DeliveryCommandRequest) {
    if (!(await this.requireCapability(input, "delivery:manage")))
      return fail("FORBIDDEN", "Delivery management capability is required", input.requestId);
    const row = await this.env.DB.prepare("SELECT status FROM delivery_job WHERE order_id=?")
      .bind(input.orderId)
      .first<{ status: string }>();
    if (!row) return fail("NOT_FOUND", "Delivery job not found", input.requestId);
    const next = transition(
      row.status,
      input.action === "DISPATCH"
        ? "DISPATCHED"
        : input.action === "DELIVER"
          ? "DELIVERED"
          : "FAILED",
      deliveryTransitions,
    );
    await this.env.DB.prepare("UPDATE delivery_job SET status=?, delivered_at=? WHERE order_id=?")
      .bind(next, next === "DELIVERED" ? Date.now() : null, input.orderId)
      .run();
    if (next === "DELIVERED")
      await this.env.DB.prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?")
        .bind(input.orderId)
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
function fail(
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT",
  message: string,
  requestId: string,
) {
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
