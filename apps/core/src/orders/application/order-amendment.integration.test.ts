import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createOrderAmendment } from "./create-order-amendment";
import { applyAmendmentPaymentReaction } from "./apply-amendment-payment-reaction";
import { createAmendmentPaymentIntent } from "../../payments/application/create-amendment-payment-intent";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";

let counter = 0;
async function committedOrder() {
  const n = ++counter;
  const customerId = `cust-amd-${n}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES (?, ?, (SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'), 'ACTIVE', ?, NULL, ?, ?)",
  )
    .bind(crypto.randomUUID(), customerId, now, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, delivery_zone_code, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'R', '09', '{}', 10.3, 123.9, 'CEBU_CITY_CORE', 'active', 1, ?, ?)",
  )
    .bind(`addr-${n}`, customerId, now, now)
    .run();
  const poolId = `pool-amd-${n}-${crypto.randomUUID().slice(0, 6)}`;
  const productId = `product-amd-${n}`;
  const skuId = `sku-amd-${n}`;
  await env.DB.prepare(
    "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, created_at, updated_at) VALUES (?, ?, 'unit-gram', 'STOCKED', 1, 1)",
  )
    .bind(poolId, productId)
    .run();
  await env.DB.prepare(
    "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, description, status, created_at, updated_at) VALUES (?, (SELECT id FROM category LIMIT 1), ?, ?, 'Amd Product', NULL, 'active', 1, 1)",
  )
    .bind(productId, poolId, `amd-${n}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, consumption_base_quantity, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'Amd 500g', 'unit-gram', 500, 'active', 1, 1, 1)",
  )
    .bind(skuId, productId, `amd-${n}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO location_product_availability (location_id, product_id, availability_status, sourcing_mode, valid_from) VALUES ('location-cebu-central', ?, 'AVAILABLE', NULL, 0)",
  )
    .bind(productId)
    .run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES ('location-cebu-central', ?, 50000, 0, 1)",
  )
    .bind(poolId)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO price_version (id, sku_id, market_id, currency, amount_minor, price_type, valid_from, version, created_at) VALUES (?, ?, 'market-metro-cebu', 'PHP', 8000, 'STANDARD', 0, 1, 1)",
  )
    .bind(crypto.randomUUID(), skuId)
    .run();

  // Committed order skeleton with snapshot and one reaction link.
  const orderId = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  const reactionId = crypto.randomUUID();
  const cycleId = (await env.DB.prepare(
    "SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1",
  ).first<{ id: string }>())!.id;
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 16000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(intentId, orderId, customerId, `pi-${intentId}`, now, now)
    .run();
  const attemptId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 16000, 'PHP', 'SUCCEEDED', 'canonical', ?, ?, ?)",
  )
    .bind(attemptId, customerId, intentId, `pa-${intentId}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, ?, '{}', 'COMMITTED', 16000, 'PHP', ?, ?, 5)",
  )
    .bind(orderId, customerId, cycleId, attemptId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, fulfillment_mode, sourcing_modes_json, created_at) VALUES (?, 'location-cebu-central', ?, 'zone-cebu-city-core', ?, ?, 'SCHEDULED', '[\"STOCKED\"]', ?)",
  )
    .bind(orderId, cycleId, now + 86_400_000, now + 172_800_000, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, applied_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), intentId, reactionId, orderId, now)
    .run();

  return { customerId, orderId, skuId, intentId };
}

describe("paid-order amendments", () => {
  it("creates an additive amendment priced fresh without touching the original", async () => {
    const fixture = await committedOrder();
    const before = await env.DB.prepare("SELECT total_minor FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ total_minor: number }>();

    const result = await createOrderAmendment(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: fixture.skuId, quantity: 2 }],
      idempotencyKey: `amend-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("PENDING_PAYMENT");
    expect(result.value.financial.totalMinor).toBe(16000); // 2 x 500g x 80.00

    // Original commercial history unchanged.
    const after = await env.DB.prepare("SELECT total_minor FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ total_minor: number }>();
    expect(after?.total_minor).toBe(before?.total_minor);

    const payment = await createAmendmentPaymentIntent(
      env.DB,
      new ProviderRegistry("test", [createMockPaymentProvider()]),
      "mock",
      {
        customerId: fixture.customerId,
        amendmentId: result.value.amendmentId,
        expectedAmendmentVersion: result.value.version,
        expectedCurrency: result.value.financial.currency,
        expectedTotalMinor: result.value.financial.totalMinor,
        returnUrl: "https://freshmarkets.ph/orders",
        idempotencyKey: `amendment-payment-${crypto.randomUUID()}`,
        requestId: "amendment-payment",
        headers: {},
      },
    );
    expect(payment.ok).toBe(true);
    const started = await env.DB.prepare(
      "SELECT a.status,pi.amount_minor amount,pi.purpose FROM paid_order_amendment a JOIN payment_intent pi ON pi.id=a.payment_intent_id WHERE a.id=?",
    )
      .bind(result.value.amendmentId)
      .first();
    expect(started).toEqual({
      status: "PENDING_PAYMENT",
      amount: 16000,
      purpose: "ORDER_AMENDMENT",
    });

    // Its own SUCCEEDED reaction commits only the delta.
    const intentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'ORDER_AMENDMENT', 'paid_order_amendment', ?, ?, 16000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
    )
      .bind(
        intentId,
        result.value.amendmentId,
        fixture.customerId,
        `pi-${intentId}`,
        Date.now(),
        Date.now(),
      )
      .run();
    await env.DB.prepare("UPDATE paid_order_amendment SET payment_intent_id=? WHERE id=?")
      .bind(intentId, result.value.amendmentId)
      .run();
    const outcome = await applyAmendmentPaymentReaction(env.DB, {
      reactionId: crypto.randomUUID(),
      paymentIntentId: intentId,
      amendmentId: result.value.amendmentId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    // Additive delta lands on the same order's operational records.
    const reservations = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=?",
    )
      .bind(fixture.orderId)
      .first<{ total: number }>();
    expect(reservations?.total).toBe(1000);
  });

  it("rejects unpaid or final orders and stale versions", async () => {
    const fixture = await committedOrder();
    const stale = await createOrderAmendment(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      expectedOrderVersion: 1,
      additions: [{ skuId: fixture.skuId, quantity: 1 }],
      idempotencyKey: `amend-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    await env.DB.prepare("UPDATE grocery_order SET status='DELIVERED' WHERE id=?")
      .bind(fixture.orderId)
      .run();
    const final = await createOrderAmendment(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      expectedOrderVersion: 6,
      additions: [{ skuId: fixture.skuId, quantity: 1 }],
      idempotencyKey: `amend-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(final).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });

  it("conceals ownership and binds idempotency to the complete request", async () => {
    const fixture = await committedOrder();
    const other = `other-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    )
      .bind(other, `auth-${other}`)
      .run();
    const key = `amend-${crypto.randomUUID()}`;
    const hidden = await createOrderAmendment(env.DB, {
      customerId: other,
      orderId: fixture.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: fixture.skuId, quantity: 1 }],
      idempotencyKey: key,
      requestId: "hidden",
    });
    const created = await createOrderAmendment(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: fixture.skuId, quantity: 1 }],
      idempotencyKey: key,
      requestId: "created",
    });
    const conflict = await createOrderAmendment(env.DB, {
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: fixture.skuId, quantity: 2 }],
      idempotencyKey: key,
      requestId: "conflict",
    });
    expect(hidden).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(created.ok).toBe(true);
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
});
