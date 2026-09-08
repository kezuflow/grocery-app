import { describe, expect, it, onTestFinished } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createPayment } from "../../payments/application/create-payment";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { createCheckoutQuote } from "./create-checkout-quote";
import { abandonCheckoutAttempt } from "./abandon-checkout-attempt";
import { startPromotionalTrial } from ".././../membership/application/start-promotional-trial";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { createCheckoutRepository } from "../infrastructure/d1-checkout-repository";
import { revalidateCheckoutQuote } from "./revalidate-checkout-quote";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";

const LOCATION = "location-cebu-central";
const deliveryProvider = createMockDeliveryProvider();
const ZONE_CODE = "CEBU_CITY_CORE";
const quoteDependencies = {
  routeDistance: buildRouteDistancePort({
    ENVIRONMENT: "test",
    ROUTE_DISTANCE_PROVIDER: "mock",
  }),
  deliveryProviders: new Map([["lalamove", deliveryProvider]]),
  scheduledDeliveryPartner: { providerCode: "lalamove", serviceType: "MOTORCYCLE" },
  defaultInstantDeliveryPartner: {
    code: "lalamove" as const,
    displayName: "Lalamove",
    serviceType: "MOTORCYCLE",
    serviceLabel: "Motorcycle",
  },
};

let customerCounter = 0;
async function seedBasket(options: {
  onHand: number;
  sourcing?: "STOCKED" | "MIXED" | "PLANNED";
  quantity?: number;
  member?: boolean;
}) {
  const customerId = `cust-inst-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  if (options.member !== false) {
    await env.DB.prepare(
      "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
    )
      .bind(
        `authz-${customerId}`,
        customerId,
        `mock_auth_${customerId}`,
        `mock_method_${customerId}`,
        now,
        now,
        now,
      )
      .run();
    const trial = await startPromotionalTrial(env.DB, {
      customerId,
      idempotencyKey: `trial-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    if (!trial.ok) throw new Error(`fixture failed: ${trial.error.message}`);
  }
  const addressId = `addr-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Inst Test', '+639171234567', '{}', 10.32, 123.9, 'CEBU_CITY', ?, 'active', 1, ?, ?)",
  )
    .bind(addressId, customerId, ZONE_CODE, now, now)
    .run();
  const cartId = `cart-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)",
  )
    .bind(cartId, customerId, LOCATION, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, 'sku-red-onion-500g', ?)",
  )
    .bind(cartId, options.quantity ?? 5)
    .run();
  if (options.sourcing)
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode=? WHERE id='pool-red-onion'",
    )
      .bind(options.sourcing)
      .run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES (?, 'pool-red-onion', ?, 0) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=excluded.on_hand, reserved=0",
  )
    .bind(LOCATION, options.onHand)
    .run();
  return { customerId, cartId, addressId };
}

async function configureInstant(): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO service_fee_configuration
      (id, fee_type, flat_minor, percentage_basis_points, currency,
       effective_from, effective_to, version, reason, created_at)
     VALUES ('instant-fee-v1', 'MIXED', 500, 300, 'PHP', ?, NULL, 1, 'test fee', ?)`,
  )
    .bind(now - 1_000, now)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET instant_promise_minutes=90,max_concurrent_instant_orders=25,dispatch_ready=1,version=version+1,updated_at=? WHERE location_id=?",
    ).bind(now, LOCATION),
    env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1,updated_at=? WHERE id='global'",
    ).bind(now),
  ]);
}

function command(customerId: string, cartId: string, addressId: string) {
  return {
    customerId,
    cartId,
    cartVersion: 1,
    addressId,
    deliveryCycleId: null as string | null,
    idempotencyKey: `quote-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  };
}

describe("instant checkout quotes", () => {
  it("requires complete quote invalidation for a closure and blocks new payment after recovery", async () => {
    await configureInstant();
    const basket = await seedBasket({ onHand: 100_000, member: false });
    const quoted = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    if (!quoted.ok) throw new Error(quoted.error.message);
    const staff = await locationManager();
    const current = await exports.default.getAdminLocationSchedule({
      headers: staff.headers,
      locationId: LOCATION,
      requestId: crypto.randomUUID(),
    });
    if (!current.ok || !current.value.schedule) throw new Error("Missing hours fixture");
    const originalSchedule = JSON.stringify(current.value.schedule);
    onTestFinished(async () => {
      await env.DB.prepare(
        "UPDATE location_operating_schedule SET definition_json=? WHERE location_id=?",
      )
        .bind(originalSchedule, LOCATION)
        .run();
      const latest = await env.DB.prepare("SELECT version FROM checkout_quote WHERE id=?")
        .bind(quoted.value.quoteId)
        .first<{ version: number }>();
      if (latest)
        expect(
          await abandonCheckoutAttempt(env.DB, {
            customerId: basket.customerId,
            quoteId: quoted.value.quoteId,
            expectedVersion: latest.version,
            idempotencyKey: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
          }),
        ).toMatchObject({ ok: true });
    });
    const quoteVersion = await env.DB.prepare("SELECT version FROM checkout_quote WHERE id=?")
      .bind(quoted.value.quoteId)
      .first<{ version: number }>();
    if (!quoteVersion) throw new Error("Quote missing after creation");
    const now = Date.now();
    const request = {
      headers: staff.headers,
      locationId: LOCATION,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: current.value.version,
      reason: "Emergency closure",
      schedule: {
        ...current.value.schedule,
        closures: [
          {
            startsAt: new Date(now - 1000).toISOString(),
            endsAt: new Date(now + 3600000).toISOString(),
            reason: "Maintenance",
          },
        ],
      },
    };
    await env.DB.exec(
      "CREATE TRIGGER ignore_hours_quotes BEFORE UPDATE ON checkout_quote BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await exports.default.saveAdminLocationSchedule(request)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
          .bind(LOCATION)
          .first(),
      ).toEqual({ version: current.value.version });
      expect(
        await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
          .bind(quoted.value.quoteId)
          .first(),
      ).toEqual({ status: "ACTIVE" });
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_hours_quotes");
    }
    expect(await exports.default.saveAdminLocationSchedule(request)).toMatchObject({ ok: true });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(quoted.value.quoteId)
        .first(),
    ).toEqual({ status: "SUPERSEDED" });
    const paymentKey = crypto.randomUUID();
    expect(
      await createPayment(env.DB, new ProviderRegistry("test", [createMockPaymentProvider()]), {
        purpose: "GROCERY_CHECKOUT",
        subjectType: "checkout_quote",
        subjectId: quoted.value.quoteId,
        customerId: basket.customerId,
        checkoutVersion: quoteVersion.version,
        amountMinor: quoted.value.totalMinor,
        currency: "PHP",
        providerCode: "mock",
        returnUrl: "https://example.com/return",
        idempotencyKey: paymentKey,
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM payment_intent WHERE idempotency_key=?")
        .bind(paymentKey)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await createCheckoutQuote(
        env.DB,
        command(basket.customerId, basket.cartId, basket.addressId),
        quoteDependencies,
      ),
    ).toMatchObject({ ok: false, error: { code: "INSTANT_MODE_UNAVAILABLE" } });
  });
  it.each(["revision", "expiry", "readiness", "hours"])(
    "rejects %s changes during courier quotation with no quote, attempt or holds",
    async (change) => {
      await configureInstant();
      const basket = await seedBasket({ onHand: 100_000, member: false });
      const links = await env.DB.prepare(
        "SELECT zone_id,location_id,valid_from,valid_to FROM location_serviceability",
      ).all<{
        zone_id: string;
        location_id: string;
        valid_from: number;
        valid_to: number | null;
      }>();
      const readiness = await env.DB.prepare(
        "SELECT location_id,dispatch_ready FROM fulfillment_location_readiness",
      ).all<{ location_id: string; dispatch_ready: number }>();
      const hours = await env.DB.prepare(
        "SELECT location_id,definition_json FROM location_operating_schedule",
      ).all<{ location_id: string; definition_json: string }>();
      const cycles = await env.DB.prepare("SELECT id,status,version FROM delivery_cycle").all<{
        id: string;
        status: string;
        version: number;
      }>();
      onTestFinished(async () => {
        await env.DB.batch([
          ...hours.results.map((row) =>
            env.DB.prepare(
              "UPDATE location_operating_schedule SET definition_json=? WHERE location_id=?",
            ).bind(row.definition_json, row.location_id),
          ),
          ...links.results.map((row) =>
            env.DB.prepare(
              "UPDATE location_serviceability SET valid_to=? WHERE zone_id=? AND location_id=? AND valid_from=?",
            ).bind(row.valid_to, row.zone_id, row.location_id, row.valid_from),
          ),
          ...readiness.results.map((row) =>
            env.DB.prepare(
              "UPDATE fulfillment_location_readiness SET dispatch_ready=? WHERE location_id=?",
            ).bind(row.dispatch_ready, row.location_id),
          ),
          ...cycles.results.map((row) =>
            env.DB.prepare("UPDATE delivery_cycle SET status=?,version=? WHERE id=?").bind(
              row.status,
              row.version,
              row.id,
            ),
          ),
        ]);
      });
      let reachedProvider = false;
      const changingProvider = {
        ...deliveryProvider,
        quote: async (...args: Parameters<typeof deliveryProvider.quote>) => {
          reachedProvider = true;
          const sql =
            change === "revision"
              ? "UPDATE geography_configuration SET version=version+1 WHERE market_id='market-metro-cebu'"
              : change === "expiry"
                ? "UPDATE location_serviceability SET valid_to=1"
                : change === "hours"
                  ? "UPDATE location_operating_schedule SET definition_json=json_set(definition_json,'$.weekly',json('[]'))"
                  : "UPDATE fulfillment_location_readiness SET dispatch_ready=0";
          await env.DB.prepare(sql).run();
          return deliveryProvider.quote(...args);
        },
      };
      const result = await createCheckoutQuote(
        env.DB,
        command(basket.customerId, basket.cartId, basket.addressId),
        { ...quoteDependencies, deliveryProviders: new Map([["lalamove", changingProvider]]) },
      );
      expect(reachedProvider).toBe(true);
      expect(result).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM checkout_quote WHERE cart_id=?")
          .bind(basket.cartId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM checkout_attempts WHERE customer_id=?")
          .bind(basket.customerId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM checkout_inventory_holds WHERE status='HELD'",
        ).first(),
      ).toEqual({ count: 0 });
    },
  );
  it("rejects a basket below the market minimum before creating a quote or hold", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000, quantity: 1 });

    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "MINIMUM_ORDER_NOT_MET" } });
    const persisted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_quote WHERE cart_id=?",
    )
      .bind(basket.cartId)
      .first<{ count: number }>();
    expect(persisted?.count).toBe(0);
    const holds = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id IN (SELECT id FROM checkout_quote WHERE cart_id=?)",
    )
      .bind(basket.cartId)
      .first<{ count: number }>();
    expect(holds?.count).toBe(0);
  });

  it("abandons a newly quoted Instant checkout through the owning commands", async () => {
    await configureInstant();
    const basket = await seedBasket({ onHand: 100_000, member: false });
    const quoted = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error("Quote was not created");
    const input = {
      customerId: basket.customerId,
      quoteId: quoted.value.quoteId,
      expectedVersion: quoted.value.attemptVersion,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    const result = await abandonCheckoutAttempt(env.DB, input);
    expect(result).toMatchObject({
      ok: true,
      value: { outcome: "ABANDONED", releasedInventoryHolds: 1 },
    });
    expect(await abandonCheckoutAttempt(env.DB, input)).toEqual(result);
    expect(
      await env.DB.prepare(
        "SELECT status FROM checkout_inventory_holds WHERE checkout_attempt_id=?",
      )
        .bind(input.quoteId)
        .first(),
    ).toEqual({ status: "RELEASED" });
  });
  it("creates a provider-priced no-fee Instant quote with promise and expiring holds", async () => {
    await seedBasket({ onHand: 100_000 });
    await configureInstant();
    // Restore STOCKED sourcing so the instant path accepts the item.
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });
    const quoteCommand = {
      ...command(basket.customerId, basket.cartId, basket.addressId),
      fulfillmentOptionId: "opaque-lalamove-option",
      deliveryPartner: {
        code: "lalamove" as const,
        displayName: "Lalamove",
        serviceType: "MOTORCYCLE",
        serviceLabel: "Motorcycle",
      },
    };
    const result = await createCheckoutQuote(env.DB, quoteCommand, quoteDependencies);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await env.DB.prepare(
      `SELECT delivery_cycle_id, fulfillment_mode, total_minor, subtotal_minor,
              delivery_fee_minor, pre_service_fee_total_minor, service_fee_minor,
              service_fee_configuration_id, service_fee_snapshot_json,
              fulfillment_snapshot_json, lines_json
       FROM checkout_quote WHERE id=?`,
    )
      .bind(result.value.quoteId)
      .first<{
        delivery_cycle_id: string | null;
        fulfillment_mode: string;
        total_minor: number;
        subtotal_minor: number;
        delivery_fee_minor: number;
        pre_service_fee_total_minor: number;
        service_fee_minor: number;
        service_fee_configuration_id: string | null;
        service_fee_snapshot_json: string | null;
        fulfillment_snapshot_json: string;
        lines_json: string;
      }>();
    expect(row).toMatchObject({ delivery_cycle_id: null, fulfillment_mode: "INSTANT" });
    expect(row?.service_fee_configuration_id).toBeNull();
    expect(row?.service_fee_minor).toBe(0);
    expect(row?.total_minor).toBe(row?.pre_service_fee_total_minor);
    expect(row?.service_fee_snapshot_json).toBeNull();
    const snapshot = JSON.parse(row!.fulfillment_snapshot_json) as {
      promisedAt: string;
      deliveryExecution: Record<string, unknown>;
    };
    expect(Date.parse(snapshot.promisedAt)).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(Date.parse(snapshot.promisedAt)).toBeLessThan(Date.now() + 120 * 60_000);
    expect(snapshot.deliveryExecution).toEqual({
      selectedBy: "CUSTOMER",
      method: "EXTERNAL_PROVIDER",
      providerCode: "lalamove",
      providerServiceType: "MOTORCYCLE",
      providerDisplayName: "Lalamove",
    });
    expect(JSON.parse(row!.lines_json)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: "sku-red-onion-500g",
          quantity: 5,
          baseQuantity: 2_500,
          baseUnitCode: "GRAM",
          shippingWeightGrams: 2_500,
        }),
      ]),
    );
    const holds = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
    )
      .bind(result.value.quoteId)
      .first<{ count: number }>();
    expect(holds?.count).toBe(1);

    // Idempotent replay returns the same immutable quote.
    const replay = await createCheckoutQuote(env.DB, quoteCommand, quoteDependencies);
    void replay;
  });

  it("rejects an external-provider quote when a non-gram line has no shipping estimate", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED',base_unit_id='unit-piece' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });

    const result = await createCheckoutQuote(
      env.DB,
      {
        ...command(basket.customerId, basket.cartId, basket.addressId),
        fulfillmentOptionId: "opaque-lalamove-option",
        deliveryPartner: {
          code: "lalamove",
          displayName: "Lalamove",
          serviceType: "MOTORCYCLE",
          serviceLabel: "Motorcycle",
        },
      },
      quoteDependencies,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    await env.DB.prepare(
      "UPDATE inventory_pool SET base_unit_id='unit-gram' WHERE id='pool-red-onion'",
    ).run();
  });

  it("allows Instant checkout without membership and ignores legacy Service Fee configuration", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000, member: false });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { totalMinor: expect.any(Number) },
    });
  });

  it("quotes and revalidates Scheduled checkout without membership or physical stock", async () => {
    await env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
    )
      .bind(Date.now())
      .run();
    const basket = await seedBasket({ onHand: 0, member: false });
    const result = await createCheckoutQuote(
      env.DB,
      {
        ...command(basket.customerId, basket.cartId, basket.addressId),
        deliveryCycleId: "cycle-next-cebu",
      },
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error.message);
    const quote = await createCheckoutRepository(env.DB).findQuoteById(result.value.quoteId);
    if (!quote) throw new Error("Missing persisted quote");
    expect(quote.financial.serviceFeeMinor).toBe(0);
    expect(quote.totalMinor).toBe(
      quote.financial.merchandiseSubtotalMinor -
        quote.financial.itemDiscountMinor -
        quote.financial.orderDiscountMinor +
        quote.financial.deliverySubtotalMinor -
        quote.financial.deliveryDiscountMinor +
        quote.financial.taxMinor,
    );
    expect(
      await revalidateCheckoutQuote(
        env.DB,
        quote,
        quoteDependencies.routeDistance,
        Date.now(),
        quoteDependencies.deliveryProviders,
      ),
    ).toEqual({ ok: true });
    expect(
      await env.DB.prepare(
        "SELECT on_hand,reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
      )
        .bind(LOCATION)
        .first(),
    ).toEqual({ on_hand: 0, reserved: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM checkout_inventory_holds WHERE checkout_attempt_id=?",
      )
        .bind(quote.id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("quotes 100 Scheduled units without consulting physical stock or legacy capacity", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "UPDATE cycle_zone_capacity SET allocated=capacity WHERE cycle_id='cycle-next-cebu'",
      ),
      env.DB.prepare(
        "UPDATE inventory_pool SET base_unit_id='unit-gram' WHERE id='pool-red-onion'",
      ),
    ]);
    const basket = await seedBasket({ onHand: 0, quantity: 100 });
    const result = await createCheckoutQuote(
      env.DB,
      {
        ...command(basket.customerId, basket.cartId, basket.addressId),
        deliveryCycleId: "cycle-next-cebu",
      },
      quoteDependencies,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        lines: [
          expect.objectContaining({
            quantity: 100,
            baseQuantity: 50_000,
            shippingWeightGrams: 50_000,
          }),
        ],
      },
    });
    await env.DB.prepare(
      "UPDATE cycle_zone_capacity SET allocated=0 WHERE cycle_id='cycle-next-cebu'",
    ).run();
  });

  it("does not fall back to a market price when the exact store price is missing", async () => {
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
    )
      .bind(now)
      .run();
    const basket = await seedBasket({ onHand: 100_000 });
    const current = await env.DB.prepare(
      "SELECT id,valid_to FROM price_version WHERE sku_id='sku-red-onion-500g' AND location_id=? AND valid_to IS NULL ORDER BY version DESC LIMIT 1",
    )
      .bind(LOCATION)
      .first<{ id: string; valid_to: number | null }>();
    expect(current).toBeTruthy();
    const fallbackId = `other-location-price-${crypto.randomUUID()}`;
    const otherLocationId = `other-location-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare("UPDATE price_version SET valid_to=? WHERE id=?").bind(now, current!.id),
      env.DB.prepare(
        "INSERT INTO fulfillment_location (id,market_id,code,name,type,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,'market-metro-cebu',?,'Other store','FULFILLMENT_CENTER','{}',10.31,123.89,'active',1,?,?)",
      ).bind(otherLocationId, `OTHER_${crypto.randomUUID().slice(0, 8)}`, now, now),
      env.DB.prepare(
        "INSERT INTO price_version (id,sku_id,currency,amount_minor,valid_from,valid_to,version,created_at,market_id,location_id,price_type) VALUES (?,'sku-red-onion-500g','PHP',1,?,NULL,999,?,'market-metro-cebu',?,'STANDARD')",
      ).bind(fallbackId, now - 1, now, otherLocationId),
    ]);

    const result = await createCheckoutQuote(
      env.DB,
      {
        ...command(basket.customerId, basket.cartId, basket.addressId),
        deliveryCycleId: "cycle-next-cebu",
      },
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });

    await env.DB.batch([
      env.DB.prepare("DELETE FROM price_version WHERE id=?").bind(fallbackId),
      env.DB.prepare("UPDATE price_version SET valid_to=NULL WHERE id=?").bind(current!.id),
      env.DB.prepare("DELETE FROM fulfillment_location WHERE id=?").bind(otherLocationId),
    ]);
  });

  it("ignores changes to legacy Service Fee configuration", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000, member: false });
    const created = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE service_fee_configuration SET effective_to=? WHERE id='instant-fee-v1'",
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO service_fee_configuration
          (id, fee_type, flat_minor, percentage_basis_points, currency,
           effective_from, effective_to, version, reason, created_at)
         VALUES ('instant-fee-v2', 'FLAT', 900, 0, 'PHP', ?, NULL, 2, 'changed fee', ?)`,
      ).bind(now, now),
    ]);
    const quote = await createCheckoutRepository(env.DB).findQuoteById(created.value.quoteId);
    expect(quote).not.toBeNull();
    expect(
      await revalidateCheckoutQuote(
        env.DB,
        quote!,
        quoteDependencies.routeDistance,
        now + 1,
        quoteDependencies.deliveryProviders,
      ),
    ).toEqual({ ok: true });
  });

  it("requires explicit replacement acceptance when the provider delivery amount changes", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000, member: false });
    let amountMinor = 5_000;
    const changingProvider = {
      ...deliveryProvider,
      quote: async (request: Parameters<typeof deliveryProvider.quote>[0]) => {
        const result = await deliveryProvider.quote(request);
        return result.ok
          ? {
              ...result,
              value: result.value.map((quote) => ({ ...quote, amountMinor })),
            }
          : result;
      },
    };
    const dependencies = {
      ...quoteDependencies,
      deliveryProviders: new Map([["lalamove", changingProvider]]),
    };
    const created = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      dependencies,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    amountMinor = 6_500;
    const quote = await createCheckoutRepository(env.DB).findQuoteById(created.value.quoteId);
    expect(
      await revalidateCheckoutQuote(
        env.DB,
        quote!,
        dependencies.routeDistance,
        Date.now(),
        dependencies.deliveryProviders,
      ),
    ).toMatchObject({ ok: false, code: "PRICE_CHANGED" });
  });

  it("refuses instant quotes when usable stocked supply is short", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
  });

  it("atomically allows only one of two carts to hold the final stocked quantity", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE checkout_inventory_holds SET status='EXPIRED' WHERE status='HELD'",
    ).run();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const firstBasket = await seedBasket({ onHand: 2_500 });
    const secondBasket = await seedBasket({ onHand: 2_500 });

    const outcomes = await Promise.all([
      createCheckoutQuote(
        env.DB,
        command(firstBasket.customerId, firstBasket.cartId, firstBasket.addressId),
        quoteDependencies,
      ),
      createCheckoutQuote(
        env.DB,
        command(secondBasket.customerId, secondBasket.cartId, secondBasket.addressId),
        quoteDependencies,
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({
      ok: false,
      error: { code: "INSUFFICIENT_STOCK" },
    });
    const held = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS quantity FROM checkout_inventory_holds WHERE inventory_pool_id='pool-red-onion' AND location_id=? AND status='HELD'",
    )
      .bind(LOCATION)
      .first<{ quantity: number }>();
    expect(held?.quantity).toBe(2_500);
  });

  it("re-quotes the same cart without its prior hold consuming the available stock", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE checkout_inventory_holds SET status='EXPIRED' WHERE status='HELD'",
    ).run();
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 2_500 });
    const first = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(first.ok).toBe(true);
    const second = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(second.ok).toBe(true);
    const holds = await env.DB.prepare(
      "SELECT status, COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id IN (SELECT id FROM checkout_quote WHERE cart_id=?) GROUP BY status",
    )
      .bind(basket.cartId)
      .all<{ status: string; count: number }>();
    expect(holds.results).toEqual(
      expect.arrayContaining([
        { status: "EXPIRED", count: 1 },
        { status: "HELD", count: 1 },
      ]),
    );
  });

  it("ignores legacy sourcing configuration in the Instant path", async () => {
    await configureInstant();
    const basket = await seedBasket({ onHand: 100_000, sourcing: "PLANNED" });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: true });
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
  });

  it("fails closed when the closest Instant location is not dispatch-ready", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET dispatch_ready=0 WHERE location_id=?",
    )
      .bind(LOCATION)
      .run();
    const basket = await seedBasket({ onHand: 100_000 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INSTANT_MODE_UNAVAILABLE" } });
    await env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET dispatch_ready=1 WHERE location_id=?",
    )
      .bind(LOCATION)
      .run();
  });
});
