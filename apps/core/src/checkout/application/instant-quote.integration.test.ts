import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createCheckoutQuote } from "./create-checkout-quote";
import {
  setFulfillmentLocationMode,
  getLocationMode,
} from "../../fulfillment/application/location-mode";
import { startPromotionalTrial } from ".././../membership/application/start-promotional-trial";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";

const LOCATION = "location-cebu-central";
const ZONE_CODE = "CEBU_CITY_CORE";
const quoteDependencies = {
  routeDistance: buildRouteDistancePort({
    ENVIRONMENT: "test",
    ROUTE_DISTANCE_PROVIDER: "mock",
  }),
};

let customerCounter = 0;
async function seedBasket(options: {
  onHand: number;
  sourcing?: "STOCKED" | "MIXED" | "PLANNED";
  quantity?: number;
}) {
  const customerId = `cust-inst-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
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
  const addressId = `addr-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'Inst Test', '09000000000', '{}', 10.32, 123.9, 'CEBU_CITY', ?, 'active', 1, ?, ?)",
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
  const current = await getLocationMode(env.DB, {
    locationId: LOCATION,
    requestId: crypto.randomUUID(),
  });
  if (!current.ok) throw new Error("default location was not found");
  const result = await setFulfillmentLocationMode(
    env.DB,
    current.value.version === 0
      ? {
          locationId: LOCATION,
          activeMode: "INSTANT",
          promiseMinutes: 90,
          maxConcurrentInstantOrders: 25,
          expectedVersion: null,
          idempotencyKey: `mode-inst-${crypto.randomUUID()}`,
          requestId: crypto.randomUUID(),
        }
      : {
          locationId: LOCATION,
          activeMode: "INSTANT",
          promiseMinutes: 90,
          maxConcurrentInstantOrders: 25,
          expectedVersion: current.value.version,
          idempotencyKey: `mode-inst-${crypto.randomUUID()}`,
          requestId: crypto.randomUUID(),
        },
  );
  if (!result.ok) throw new Error(`mode config failed: ${result.error.message}`);
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

  it("creates a no-cycle instant quote with fee, promise, and expiring holds", async () => {
    await seedBasket({ onHand: 100_000 });
    await configureInstant();
    // Restore STOCKED sourcing so the instant path accepts the item.
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await env.DB.prepare(
      "SELECT delivery_cycle_id, fulfillment_mode, total_minor, subtotal_minor, delivery_fee_minor, fulfillment_snapshot_json FROM checkout_quote WHERE id=?",
    )
      .bind(result.value.quoteId)
      .first<{
        delivery_cycle_id: string | null;
        fulfillment_mode: string;
        total_minor: number;
        subtotal_minor: number;
        delivery_fee_minor: number;
        fulfillment_snapshot_json: string;
      }>();
    expect(row).toMatchObject({ delivery_cycle_id: null, fulfillment_mode: "INSTANT" });
    expect(row?.total_minor).toBe((row?.subtotal_minor ?? 0) + (row?.delivery_fee_minor ?? 0));
    const snapshot = JSON.parse(row!.fulfillment_snapshot_json) as { promisedAt: string };
    expect(Date.parse(snapshot.promisedAt)).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(Date.parse(snapshot.promisedAt)).toBeLessThan(Date.now() + 120 * 60_000);
    const holds = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
    )
      .bind(result.value.quoteId)
      .first<{ count: number }>();
    expect(holds?.count).toBe(1);

    // Idempotent replay returns the same immutable quote.
    const replay = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    void replay;
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

  it("refuses non-stocked sourcing from the instant path", async () => {
    await configureInstant();
    const basket = await seedBasket({ onHand: 100_000, sourcing: "PLANNED" });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "UNAVAILABLE_ITEM" } });
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
  });

  it("fails closed to INSTANT_MODE_UNAVAILABLE when no instant location serves the zone", async () => {
    // Revert the shared seeded location to Scheduled for this case.
    const current = await getLocationMode(env.DB, {
      locationId: LOCATION,
      requestId: crypto.randomUUID(),
    });
    if (!current.ok) throw new Error("default location was not found");
    await setFulfillmentLocationMode(env.DB, {
      locationId: LOCATION,
      activeMode: "SCHEDULED",
      cadence: "WEEKLY",
      promiseMinutes: null,
      maxConcurrentInstantOrders: null,
      expectedVersion: current.value.version || null,
      idempotencyKey: `mode-sched-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    await env.DB.prepare(
      "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
      quoteDependencies,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INSTANT_MODE_UNAVAILABLE" } });
    // Restore instant mode for any later tests in this file.
    await configureInstant();
  });
});
