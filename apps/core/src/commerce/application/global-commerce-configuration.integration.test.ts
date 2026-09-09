import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activateGlobalFulfillmentMode,
  getGlobalCommerceConfiguration,
  openSelling,
  pauseSelling,
  requireSellingOpen,
} from "./global-commerce-configuration";
import { listFulfillmentOptions } from "../../checkout/application/list-fulfillment-options";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { createCheckoutPaymentIntent } from "../../payments/application/create-checkout-payment-intent";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import type { PaymentProviderRegistry } from "../../payments/ports/provider-registry";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";

const routeDistance = buildRouteDistancePort({
  ENVIRONMENT: "test",
  ROUTE_DISTANCE_PROVIDER: "mock",
});

function command(expectedVersion: number, suffix: string = crypto.randomUUID()) {
  return {
    expectedVersion,
    idempotencyKey: `commerce-${suffix}`,
    requestId: `request-${suffix}`,
  };
}

async function makeInstantReady() {
  await env.DB.prepare(
    `UPDATE fulfillment_location_readiness
        SET dispatch_ready=1,instant_promise_minutes=45,
            max_concurrent_instant_orders=10,version=version+1,updated_at=?
      WHERE location_id='location-cebu-central'`,
  )
    .bind(Date.now())
    .run();
}

async function seedQuote(withPayment: boolean) {
  const suffix = crypto.randomUUID();
  const customerId = `commerce-customer-${suffix}`;
  const addressId = `commerce-address-${suffix}`;
  const quoteId = `commerce-quote-${suffix}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(customerId, `auth-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.3,123.9,'active',1,?,?)",
    ).bind(addressId, customerId, now, now),
    env.DB.prepare(
      `INSERT INTO checkout_quote
          (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,
           fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,status,
           version,expires_at,idempotency_key,created_at,updated_at)
         VALUES (?,?,?,?,?,'cycle-next-cebu','SCHEDULED','PHP',100,100,'[]','ACTIVE',1,?,?,?,?)`,
    ).bind(
      quoteId,
      quoteId,
      customerId,
      `cart-${suffix}`,
      addressId,
      now + 60_000,
      `quote-${suffix}`,
      now,
      now,
    ),
  ]);
  if (withPayment)
    await env.DB.prepare(
      `INSERT INTO payment_intent
        (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,
         idempotency_key,version,created_at,updated_at)
       VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','PROCESSING',?,1,?,?)`,
    )
      .bind(`payment-${suffix}`, quoteId, customerId, `payment-${suffix}`, now, now)
      .run();
  return quoteId;
}

describe("global commerce configuration", () => {
  it.each([
    ["SCHEDULED", "DAILY"],
    ["SCHEDULED", null],
    ["INSTANT", "WEEKLY"],
  ])(
    "rejects unsupported stored mode/cadence (%s, %s) without opening commerce",
    async (mode, cadence) => {
      await env.DB.prepare(
        "UPDATE global_commerce_configuration SET fulfillment_mode=?,cadence=? WHERE id='global'",
      )
        .bind(mode, cadence)
        .run();
      expect(await getGlobalCommerceConfiguration(env.DB, { requestId: "read" })).toMatchObject({
        ok: false,
        error: { code: "CONFIGURATION_ERROR" },
      });
      expect(await requireSellingOpen(env.DB, "checkout")).toMatchObject({
        ok: false,
        error: { code: "CONFIGURATION_ERROR" },
      });
      expect(await openSelling(env.DB, command(1))).toMatchObject({
        ok: false,
        error: { code: "CONFIGURATION_ERROR" },
      });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE scope LIKE 'commerce.%'",
        ).first(),
      ).toEqual({ count: 0 });
    },
  );
  beforeEach(async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY',version=1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare("DELETE FROM idempotency_records WHERE scope LIKE 'commerce.%'"),
      env.DB.prepare("UPDATE delivery_cycle_zone SET status='ACTIVE'"),
    ]);
  });

  it("pauses, switches only while paused, and reopens after readiness", async () => {
    await makeInstantReady();
    const initial = await getGlobalCommerceConfiguration(env.DB, { requestId: "initial" });
    expect(initial).toMatchObject({
      ok: true,
      value: { sellingState: "OPEN", fulfillmentMode: "SCHEDULED", version: 1 },
    });

    expect(
      await activateGlobalFulfillmentMode(env.DB, {
        ...command(1),
        fulfillmentMode: "INSTANT",
        cadence: null,
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });

    expect(await pauseSelling(env.DB, command(1))).toMatchObject({
      ok: true,
      value: { sellingState: "PAUSED", version: 2 },
    });
    expect(await requireSellingOpen(env.DB, "paused")).toMatchObject({
      ok: false,
      error: { code: "CONFIGURATION_ERROR" },
    });
    expect(
      await activateGlobalFulfillmentMode(env.DB, {
        ...command(2),
        fulfillmentMode: "INSTANT",
        cadence: null,
      }),
    ).toMatchObject({
      ok: true,
      value: { sellingState: "PAUSED", fulfillmentMode: "INSTANT", version: 3 },
    });
    expect(await openSelling(env.DB, command(3))).toMatchObject({
      ok: true,
      value: { sellingState: "OPEN", fulfillmentMode: "INSTANT", version: 4 },
    });
  });

  it.each(["SCHEDULED", "INSTANT"] as const)(
    "switches new commerce while retaining a committed %s Order",
    async (mode) => {
      const id = `retained-mode-${crypto.randomUUID()}`;
      await seedTestInstantOrder(env.DB, id);
      await env.DB.prepare(
        "UPDATE grocery_order SET status='COMMITTED',fulfillment_mode=?,cycle_id=? WHERE id=?",
      )
        .bind(mode, mode === "SCHEDULED" ? "cycle-next-cebu" : null, id)
        .run();
      await env.DB.prepare(
        "UPDATE global_commerce_configuration SET fulfillment_mode=?,cadence=? WHERE id='global'",
      )
        .bind(mode, mode === "SCHEDULED" ? "WEEKLY" : null)
        .run();
      const orderBefore = await env.DB.prepare(
        "SELECT fulfillment_mode,cycle_id,status,total_minor,payment_id,version FROM grocery_order WHERE id=?",
      )
        .bind(id)
        .first();
      expect(await pauseSelling(env.DB, command(1))).toMatchObject({ ok: true });
      const target = mode === "SCHEDULED" ? "INSTANT" : "SCHEDULED";
      const request = {
        ...command(2),
        fulfillmentMode: target,
        cadence: target === "SCHEDULED" ? ("WEEKLY" as const) : null,
      } as const;
      const switched = await activateGlobalFulfillmentMode(env.DB, request);
      expect(switched).toMatchObject({
        ok: true,
        value: { fulfillmentMode: target, sellingState: "PAUSED", version: 3 },
      });
      expect(await activateGlobalFulfillmentMode(env.DB, request)).toEqual(switched);
      expect(
        await env.DB.prepare(
          "SELECT fulfillment_mode,cycle_id,status,total_minor,payment_id,version FROM grocery_order WHERE id=?",
        )
          .bind(id)
          .first(),
      ).toEqual(orderBefore);
    },
  );

  it("returns the exact original result on replay and rejects changed reuse", async () => {
    const attempt = command(1, "exact-replay");
    const first = await pauseSelling(env.DB, attempt);
    expect(first).toMatchObject({ ok: true, value: { version: 2 } });
    await makeInstantReady();
    await activateGlobalFulfillmentMode(env.DB, {
      ...command(2, "later-switch"),
      fulfillmentMode: "INSTANT",
      cadence: null,
    });
    expect(await pauseSelling(env.DB, attempt)).toEqual(first);
    expect(await pauseSelling(env.DB, { ...attempt, expectedVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("allows only one concurrent expected-version update", async () => {
    await pauseSelling(env.DB, command(1, "concurrent-pause"));
    await makeInstantReady();
    const [first, second] = await Promise.all([
      activateGlobalFulfillmentMode(env.DB, {
        ...command(2, "concurrent-a"),
        fulfillmentMode: "INSTANT",
        cadence: null,
      }),
      activateGlobalFulfillmentMode(env.DB, {
        ...command(2, "concurrent-b"),
        fulfillmentMode: "INSTANT",
        cadence: null,
      }),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)[0]).toMatchObject({
      error: { code: "STALE_VERSION" },
    });
  });

  it("invalidates only unstarted quotes and preserves started payment commitment evidence", async () => {
    const unstartedQuote = await seedQuote(false);
    const startedQuote = await seedQuote(true);
    await pauseSelling(env.DB, command(1, "quote-pause"));
    await makeInstantReady();
    await activateGlobalFulfillmentMode(env.DB, {
      ...command(2, "quote-switch"),
      fulfillmentMode: "INSTANT",
      cadence: null,
    });
    const rows = await env.DB.prepare(
      "SELECT id,status FROM checkout_quote WHERE id IN (?,?) ORDER BY id",
    )
      .bind(unstartedQuote, startedQuote)
      .all<{ id: string; status: string }>();
    expect(Object.fromEntries(rows.results.map((row) => [row.id, row.status]))).toEqual({
      [unstartedQuote]: "SUPERSEDED",
      [startedQuote]: "ACTIVE",
    });
  });

  it("fails reopening with controlled mode-specific readiness blockers", async () => {
    await pauseSelling(env.DB, command(1, "blocked-pause"));
    await env.DB.prepare("UPDATE delivery_cycle_zone SET status='INACTIVE'").run();
    const blocked = await openSelling(env.DB, command(2, "blocked-open"));
    expect(blocked).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const view = await getGlobalCommerceConfiguration(env.DB, { requestId: "blockers" });
    expect(view).toMatchObject({
      ok: true,
      value: {
        readinessBlockers: expect.arrayContaining([
          expect.objectContaining({ code: "SCHEDULED_WINDOW_NOT_READY" }),
        ]),
      },
    });
  });

  it("blocks new options, quotes, and payment initiation while paused", async () => {
    await pauseSelling(env.DB, command(1, "entry-gate"));
    expect(
      await listFulfillmentOptions(env.DB, routeDistance, {
        customerId: "missing-customer",
        addressId: "missing-address",
        cartId: "missing-cart",
        cartVersion: 1,
        requestId: "paused-options",
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    expect(
      await createCheckoutQuote(
        env.DB,
        {
          customerId: "missing-customer",
          cartId: "missing-cart",
          cartVersion: 1,
          addressId: "missing-address",
          deliveryCycleId: "cycle-next-cebu",
          idempotencyKey: "paused-quote",
          requestId: "paused-quote",
        },
        { routeDistance },
      ),
    ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const registry: PaymentProviderRegistry = {
      get: () => null,
      require: () => {
        throw new Error("not configured");
      },
    };
    expect(
      await createCheckoutPaymentIntent(env.DB, registry, "paymongo", routeDistance, {
        customerId: "missing-customer",
        headers: {},
        requestId: "paused-payment",
        checkoutAttemptId: "missing-quote",
        expectedQuoteVersion: 1,
        expectedPriceAcceptanceVersion: 1,
        expectedCurrency: "PHP",
        expectedMerchandiseSubtotalMinor: 100,
        expectedItemDiscountMinor: 0,
        expectedOrderDiscountMinor: 0,
        expectedDeliverySubtotalMinor: 0,
        expectedDeliveryFeeMinor: 0,
        expectedDeliveryDiscountMinor: 0,
        expectedTaxMinor: 0,
        expectedTotalMinor: 100,
        returnUrl: "https://example.test/return",
        idempotencyKey: "paused-payment",
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
  });
});
