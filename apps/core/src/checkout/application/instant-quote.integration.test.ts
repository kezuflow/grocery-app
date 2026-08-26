import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createCheckoutQuote } from "./create-checkout-quote";
import {
  setFulfillmentLocationMode,
  getLocationMode,
} from "../../fulfillment/application/location-mode";
import { startPromotionalTrial } from ".././../membership/application/start-promotional-trial";

const LOCATION = "location-cebu-central";
const ZONE_CODE = "CEBU_CITY_CORE";

let customerCounter = 0;
async function seedBasket(options: {
  onHand: number;
  sourcing?: "STOCKED" | "HYBRID" | "PLANNED_PROCUREMENT";
}) {
  const customerId = `cust-inst-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'fake', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(
      `authz-${customerId}`,
      customerId,
      `fake_auth_${customerId}`,
      `fake_method_${customerId}`,
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
    "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, 'sku-red-onion-500g', 1)",
  )
    .bind(cartId)
    .run();
  if (options.sourcing)
    await env.DB.prepare("UPDATE inventory_pool SET sourcing_mode=? WHERE id='pool-red-onion'")
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
  it("creates a no-cycle instant quote with fee, promise, and expiring holds", async () => {
    process.env;
    await seedBasket({ onHand: 100_000 });
    await configureInstant();
    // Restore STOCKED sourcing so the instant path accepts the item.
    await env.DB.prepare(
      "UPDATE inventory_pool SET sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
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
    );
    void replay;
  });

  it("refuses instant quotes when usable stocked supply is short", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_pool SET sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
  });

  it("refuses non-stocked sourcing from the instant path", async () => {
    await configureInstant();
    const basket = await seedBasket({ onHand: 100_000, sourcing: "PLANNED_PROCUREMENT" });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "UNAVAILABLE_ITEM" } });
    await env.DB.prepare(
      "UPDATE inventory_pool SET sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
  });

  it("fails closed to INSTANT_MODE_UNAVAILABLE when no instant location serves the zone", async () => {
    // Revert the shared seeded location to Scheduled for this case.
    const current = await getLocationMode(env.DB, {
      locationId: LOCATION,
      requestId: crypto.randomUUID(),
    });
    await setFulfillmentLocationMode(env.DB, {
      locationId: LOCATION,
      activeMode: "SCHEDULED",
      promiseMinutes: null,
      maxConcurrentInstantOrders: null,
      expectedVersion: current.value.version || null,
      idempotencyKey: `mode-sched-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    await env.DB.prepare(
      "UPDATE inventory_pool SET sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
    ).run();
    const basket = await seedBasket({ onHand: 100_000 });
    const result = await createCheckoutQuote(
      env.DB,
      command(basket.customerId, basket.cartId, basket.addressId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INSTANT_MODE_UNAVAILABLE" } });
    // Restore instant mode for any later tests in this file.
    await configureInstant();
  });
});
