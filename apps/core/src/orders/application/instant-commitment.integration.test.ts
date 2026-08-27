import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import {
  setFulfillmentLocationMode,
  getLocationMode,
} from "../../fulfillment/application/location-mode";
import { startPromotionalTrial } from "../../membership/application/start-promotional-trial";
import { applyCheckoutPaymentReaction } from "./apply-checkout-payment-reaction";

const LOCATION = "location-cebu-central";
const quoteDependencies = {
  routeDistance: buildRouteDistancePort({
    ENVIRONMENT: "test",
    ROUTE_DISTANCE_PROVIDER: "mock",
  }),
};
const ZONE_CODE = "CEBU_CITY_CORE";
let counter = 0;

async function configureInstant(maxOrders = 25): Promise<void> {
  const current = await getLocationMode(env.DB, {
    locationId: LOCATION,
    requestId: crypto.randomUUID(),
  });
  const result = await setFulfillmentLocationMode(env.DB, {
    locationId: LOCATION,
    activeMode: "INSTANT",
    promiseMinutes: 60,
    maxConcurrentInstantOrders: maxOrders,
    expectedVersion: current.value.version || null,
    idempotencyKey: `mode-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!result.ok) throw new Error(`mode config failed: ${result.error.message}`);
}

async function seededInstantQuote(): Promise<{ quoteId: string; customerId: string }> {
  const customerId = `cust-cmt-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
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
  if (!trial.ok) throw new Error("fixture failed");
  const addressId = `addr-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'C', '09', '{}', 10.32, 123.9, 'CEBU_CITY', ?, 'active', 1, ?, ?)",
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
  await env.DB.prepare(
    "UPDATE inventory_pool SET sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
  ).run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES (?, 'pool-red-onion', 1000000, 0) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=1000000",
  )
    .bind(LOCATION)
    .run();
  const quote = await createCheckoutQuote(
    env.DB,
    {
      customerId,
      cartId,
      cartVersion: 1,
      addressId,
      deliveryCycleId: null,
      idempotencyKey: `quote-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    },
    quoteDependencies,
  );
  if (!quote.ok) throw new Error(`quote failed: ${quote.error.code}`);
  return { quoteId: quote.value.quoteId, customerId };
}

async function seedReaction(quoteId: string) {
  const intentId = crypto.randomUUID();
  const reactionId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) SELECT ?, 'GROCERY_CHECKOUT', 'checkout_quote', q.id, q.customer_id, q.total_minor, q.currency, 'SUCCEEDED', ?, 2, ?, ? FROM checkout_quote q WHERE q.id=?",
    ).bind(intentId, `pi-${intentId}`, now, now, quoteId),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) SELECT ?, customer_id, id, amount_minor, currency, 'SUCCEEDED', 'mock', ?, ?, ?, ? FROM payment_intent WHERE id=?",
    ).bind(`attempt-${intentId}`, `mock_pay_${intentId}`, `intent:${intentId}`, now, now, intentId),
    env.DB.prepare(
      "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, 'COMMIT_ORDER', 'checkout_quote', ?, 'PENDING', ?, 0, ?, ?)",
    ).bind(reactionId, intentId, quoteId, `reaction:${intentId}`, now, now),
  ]);
  return { intentId, reactionId };
}

describe("instant order commitment", () => {
  it("commits a no-cycle order with promise snapshot, converted holds, and reservation", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote();
    const { reactionId, intentId } = await seedReaction(quoteId);
    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    const orderId = outcome.orderId!;
    const order = await env.DB.prepare(
      "SELECT cycle_id, fulfillment_mode FROM grocery_order WHERE id=?",
    )
      .bind(orderId)
      .first<{ cycle_id: string | null; fulfillment_mode: string }>();
    expect(order).toMatchObject({ cycle_id: null, fulfillment_mode: "INSTANT" });
    const snapshot = await env.DB.prepare(
      "SELECT promised_at, cycle_id FROM order_fulfillment_snapshot WHERE order_id=?",
    )
      .bind(orderId)
      .first<{ promised_at: number | null; cycle_id: string | null }>();
    expect(snapshot?.cycle_id).toBeNull();
    expect(snapshot?.promised_at).toBeGreaterThan(Date.now());
    const job = await env.DB.prepare(
      "SELECT fulfillment_mode, status, rider_user_id FROM delivery_job WHERE order_id=?",
    )
      .bind(orderId)
      .first<{ fulfillment_mode: string; status: string; rider_user_id: string | null }>();
    expect(job).toMatchObject({
      fulfillment_mode: "INSTANT",
      status: "PENDING",
      rider_user_id: null,
    });
    const hold = await env.DB.prepare(
      "SELECT status FROM checkout_inventory_holds WHERE checkout_attempt_id=?",
    )
      .bind(quoteId)
      .first<{ status: string }>();
    expect(hold?.status).toBe("COMMITTED");
    const reservation = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_reservation WHERE order_id=?",
    )
      .bind(orderId)
      .first<{ count: number }>();
    expect(reservation?.count).toBe(1);
  });

  it("enforces the location concurrent-order capacity", async () => {
    // Isolate capacity counting from earlier tests in this file.
    const prior = await env.DB.prepare(
      "SELECT id FROM grocery_order WHERE fulfillment_mode='INSTANT'",
    ).all<{ id: string }>();
    for (const row of prior.results ?? []) {
      await env.DB.prepare("DELETE FROM delivery_job WHERE order_id=?").bind(row.id).run();
      await env.DB.prepare("DELETE FROM inventory_reservation WHERE order_id=?").bind(row.id).run();
      await env.DB.prepare("DELETE FROM order_item WHERE order_id=?").bind(row.id).run();
      await env.DB.prepare("DELETE FROM order_payment_reaction WHERE order_id=?")
        .bind(row.id)
        .run();
      await env.DB.prepare("DELETE FROM order_fulfillment_snapshot WHERE order_id=?")
        .bind(row.id)
        .run();
      await env.DB.prepare("DELETE FROM grocery_order WHERE id=?").bind(row.id).run();
    }
    await configureInstant(1);
    const first = await seededInstantQuote();
    const firstReaction = await seedReaction(first.quoteId);
    const ok = await applyCheckoutPaymentReaction(env.DB, {
      reactionId: firstReaction.reactionId,
      paymentIntentId: firstReaction.intentId,
      checkoutAttemptId: first.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(ok.applied).toBe(true);

    const second = await seededInstantQuote();
    const secondReaction = await seedReaction(second.quoteId);
    const rejected = await applyCheckoutPaymentReaction(env.DB, {
      reactionId: secondReaction.reactionId,
      paymentIntentId: secondReaction.intentId,
      checkoutAttemptId: second.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(rejected).toMatchObject({ applied: false, reason: "CAS_CONFLICT" });
    const orders = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM grocery_order WHERE fulfillment_mode='INSTANT'",
    ).first<{ count: number }>();
    expect(orders?.count).toBe(1);
    await configureInstant(25);
  });
});
