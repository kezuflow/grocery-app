import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { applyCheckoutPaymentReaction } from "./apply-checkout-payment-reaction";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";

const quoteDependencies = {
  routeDistance: buildRouteDistancePort({
    ENVIRONMENT: "test",
    ROUTE_DISTANCE_PROVIDER: "mock",
  }),
};

let counter = 0;

async function seededCheckout(
  options: {
    sourcingMode?: "STOCKED" | "PLANNED" | "MIXED";
    onHand?: number;
  } = {},
) {
  const n = ++counter;
  const customerId = `cust-co-${n}-${crypto.randomUUID().slice(0, 8)}`;
  const authId = `auth-${customerId}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, authId, now, now)
    .run();
  const subscriptionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, created_at, updated_at) VALUES (?, ?, (SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'), 'TRIALING', ?, ?, ?, ?)",
  )
    .bind(subscriptionId, customerId, now, now + 86_400_000 * 30, now, now)
    .run();
  const addressId = `addr-co-${n}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, delivery_zone_code, delivery_instructions_json, notes, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'R', '09', '{}', 10.3, 123.9, 'CEBU_CITY_CORE', ?, 'Legacy note must not win', 'active', 1, ?, ?)",
  )
    .bind(addressId, customerId, '{"gateGuard":"Ask guard"}', now, now)
    .run();

  // Dedicated product/pool/sku so sourcing and stock are test-controlled.
  const suffix = crypto.randomUUID().slice(0, 8);
  const poolId = `pool-co-${suffix}`;
  const productId = `product-co-${suffix}`;
  const skuId = `sku-co-${suffix}`;
  await env.DB.prepare(
    "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES (?, ?, 'unit-gram', 'STOCKED', ?, 1, 1)",
  )
    .bind(poolId, productId, options.sourcingMode ?? "STOCKED")
    .run();
  await env.DB.prepare(
    "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, description, status, created_at, updated_at) VALUES (?, (SELECT id FROM category LIMIT 1), ?, ?, 'Co Product', NULL, 'active', 1, 1)",
  )
    .bind(productId, poolId, `co-${suffix}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO sku (id, product_id, code, name, sellable_unit_id, consumption_base_quantity, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'Co 500g', 'unit-gram', 500, 'active', 1, 1, 1)",
  )
    .bind(skuId, productId, `code-${suffix}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO location_product_availability (location_id, product_id, availability_status, sourcing_mode, valid_from) VALUES ('location-cebu-central', ?, 'AVAILABLE', NULL, 0)",
  )
    .bind(productId)
    .run();
  if (options.sourcingMode !== "PLANNED") {
    await env.DB.prepare(
      "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES ('location-cebu-central', ?, ?, 0, 1)",
    )
      .bind(poolId, options.onHand ?? 100_000)
      .run();
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO price_version (id, sku_id, market_id, currency, amount_minor, price_type, valid_from, version, created_at) VALUES (?, ?, 'market-metro-cebu', 'PHP', 12000, 'STANDARD', 0, 1, 1)",
  )
    .bind(crypto.randomUUID(), skuId)
    .run();

  const cartId = `cart-co-${n}`;
  await env.DB.prepare(
    "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'ACTIVE', 3, ?, ?)",
  )
    .bind(cartId, customerId, now, now)
    .run();
  await env.DB.prepare("INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, ?, 4)")
    .bind(cartId, skuId)
    .run();

  return { customerId, cartId, addressId, skuId, poolId, subscriptionId };
}

async function createQuote(fixture: Awaited<ReturnType<typeof seededCheckout>>) {
  const cycles = await env.DB.prepare(
    "SELECT id FROM delivery_cycle WHERE status='OPEN' ORDER BY delivery_date ASC LIMIT 1",
  ).all<{ id: string }>();
  expect(cycles.results.length).toBeGreaterThan(0);
  return createCheckoutQuote(
    env.DB,
    {
      customerId: fixture.customerId,
      cartId: fixture.cartId,
      cartVersion: 3,
      addressId: fixture.addressId,
      deliveryCycleId: cycles.results[0].id,
      idempotencyKey: `quote-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    },
    quoteDependencies,
  );
}

async function intentWithReaction(quoteId: string, customerId: string) {
  const intentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 48000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(intentId, quoteId, customerId, `pi-${intentId}`, Date.now(), Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 48000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?, ?)",
  )
    .bind(
      `attempt-${intentId}`,
      customerId,
      intentId,
      `mock_pay_${intentId}`,
      `intent:${intentId}`,
      Date.now(),
      Date.now(),
    )
    .run();
  const reactionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, 'COMMIT_ORDER', 'checkout_quote', ?, 'PENDING', ?, 0, ?, ?)",
  )
    .bind(reactionId, intentId, quoteId, `reaction:${intentId}`, Date.now(), Date.now())
    .run();
  return { intentId, reactionId };
}

describe("order commitment from canonical payment reactions", () => {
  it("allows quote creation for PAST_DUE membership inside grace", async () => {
    const fixture = await seededCheckout();
    await env.DB.prepare(
      "UPDATE subscription SET status='PAST_DUE', trial_ends_at=?, grace_ends_at=?, version=version+1, updated_at=? WHERE id=?",
    )
      .bind(Date.now() - 1_000, Date.now() + 86_400_000, Date.now(), fixture.subscriptionId)
      .run();

    const quote = await createQuote(fixture);

    expect(quote.ok).toBe(true);
  });

  it("allows commitment for PAST_DUE membership still inside grace", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    await env.DB.prepare(
      "UPDATE subscription SET status='PAST_DUE', trial_ends_at=?, grace_ends_at=?, version=version+1, updated_at=? WHERE id=?",
    )
      .bind(Date.now() - 1_000, Date.now() + 86_400_000, Date.now(), fixture.subscriptionId)
      .run();
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );

    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });

    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
  });

  it("ignores insufficient canonical states", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );
    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "PROCESSING",
    });
    expect(outcome).toMatchObject({ applied: false, reason: "INSUFFICIENT_STATE" });
    const orders = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_payment_reaction WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(orders?.count).toBe(0);
  });

  it("commits once from SUCCEEDED with snapshots and stocked reservations", async () => {
    const fixture = await seededCheckout({ sourcingMode: "STOCKED" });
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );

    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    if (!outcome.orderId) throw new Error("no order");

    const order = await env.DB.prepare(
      `SELECT status, total_minor, merchandise_subtotal_minor, item_discount_minor,
              order_discount_minor, delivery_subtotal_minor, delivery_discount_minor,
              service_fee_minor, tax_minor
       FROM grocery_order WHERE id=?`,
    )
      .bind(outcome.orderId)
      .first<{
        status: string;
        total_minor: number;
        merchandise_subtotal_minor: number;
        item_discount_minor: number;
        order_discount_minor: number;
        delivery_subtotal_minor: number;
        delivery_discount_minor: number;
        service_fee_minor: number;
        tax_minor: number;
      }>();
    expect(order).toMatchObject({
      status: "COMMITTED",
      total_minor: 53000,
      merchandise_subtotal_minor: 48000,
      item_discount_minor: 0,
      order_discount_minor: 0,
      delivery_subtotal_minor: 5000,
      delivery_discount_minor: 0,
      service_fee_minor: 0,
      tax_minor: 0,
    });
    const items = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_item WHERE order_id=? AND base_quantity=2000",
    )
      .bind(outcome.orderId)
      .first<{ count: number }>();
    expect(items?.count).toBe(1);
    const reservations = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
    )
      .bind(outcome.orderId, fixture.poolId)
      .first<{ total: number }>();
    expect(reservations?.total).toBe(2000);
    const demand = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM committed_demand WHERE order_id=?",
    )
      .bind(outcome.orderId)
      .first<{ count: number }>();
    expect(demand?.count).toBe(0);
    const delivery = await env.DB.prepare(
      `SELECT dj.id AS job_id, dj.location_id, dj.zone_id, dj.cycle_id,
              ds.id AS stop_id, ds.batch_id, ds.sequence,
              ds.latitude, ds.longitude, ds.address_snapshot_json,
              ds.contact_snapshot_json, ds.instructions_snapshot, ds.status
       FROM delivery_job dj
       JOIN delivery_stop ds ON ds.delivery_job_id=dj.id
       WHERE dj.order_id=?`,
    )
      .bind(outcome.orderId)
      .first<Record<string, unknown>>();
    expect(delivery).toMatchObject({
      batch_id: null,
      sequence: null,
      location_id: "location-cebu-central",
      zone_id: "zone-cebu-city-core",
      latitude: 10.3,
      longitude: 123.9,
      contact_snapshot_json: '{"recipient":"R","phone":"09"}',
      instructions_snapshot: '{"gateGuard":"Ask guard"}',
      status: "UNASSIGNED",
    });
    expect(delivery?.job_id).toBeTypeOf("string");
    expect(delivery?.stop_id).toBeTypeOf("string");
    expect(JSON.parse(String(delivery?.address_snapshot_json))).toMatchObject({
      recipient: "R",
      phone: "09",
      latitude: 10.3,
      longitude: 123.9,
    });

    // Duplicate reaction replay returns the same order without new effects.
    const replay = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(replay).toMatchObject({
      applied: true,
      reason: "ALREADY_APPLIED",
      orderId: outcome.orderId,
    });
  });

  it("creates committed demand for planned procurement and splits hybrid", async () => {
    const planned = await seededCheckout({ sourcingMode: "PLANNED" });
    const plannedQuote = await createQuote(planned);
    if (!plannedQuote.ok) throw new Error(JSON.stringify(plannedQuote.error));
    const plannedIntent = await intentWithReaction(plannedQuote.value.quoteId, planned.customerId);
    const plannedOutcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId: plannedIntent.reactionId,
      paymentIntentId: plannedIntent.intentId,
      checkoutAttemptId: plannedQuote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(plannedOutcome.applied).toBe(true);
    const demand = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM committed_demand WHERE order_id=?",
    )
      .bind(plannedOutcome.orderId!)
      .first<{ total: number }>();
    expect(demand?.total).toBe(2000);

    const hybrid = await seededCheckout({ sourcingMode: "MIXED", onHand: 1500 });
    const hybridQuote = await createQuote(hybrid);
    if (!hybridQuote.ok) throw new Error(JSON.stringify(hybridQuote.error));
    const hybridIntent = await intentWithReaction(hybridQuote.value.quoteId, hybrid.customerId);
    const hybridOutcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId: hybridIntent.reactionId,
      paymentIntentId: hybridIntent.intentId,
      checkoutAttemptId: hybridQuote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(hybridOutcome.applied).toBe(true);
    const [reservationTotal, demandTotal] = await Promise.all([
      env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=?",
      )
        .bind(hybridOutcome.orderId!)
        .first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM committed_demand WHERE order_id=?",
      )
        .bind(hybridOutcome.orderId!)
        .first<{ total: number }>(),
    ]);
    expect(reservationTotal?.total).toBe(1500);
    expect(demandTotal?.total).toBe(500);
  });

  it("records a finance exception for an expired quote instead of committing", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error("quote failed");
    await env.DB.prepare("UPDATE checkout_quote SET expires_at=1, status='EXPIRED' WHERE id=?")
      .bind(quote.value.quoteId)
      .run();
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );
    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: false, reason: "QUOTE_UNUSABLE" });
    const exceptions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM finance_exception WHERE payment_intent_id=? AND status='OPEN'",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(exceptions?.count).toBe(1);
  });

  it("retries a paid commitment with the same identities after stock recovers", async () => {
    const fixture = await seededCheckout({ sourcingMode: "STOCKED", onHand: 0 });
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );

    const failed = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(failed).toMatchObject({ applied: false, reason: "CAS_CONFLICT" });
    const failedDeliveryRows = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM delivery_job dj JOIN grocery_order go ON go.id=dj.order_id JOIN payment_attempt pa ON pa.id=go.payment_id WHERE pa.payment_intent_id=?) AS jobs,
         (SELECT COUNT(*) FROM delivery_stop ds JOIN delivery_job dj ON dj.id=ds.delivery_job_id JOIN grocery_order go ON go.id=dj.order_id JOIN payment_attempt pa ON pa.id=go.payment_id WHERE pa.payment_intent_id=?) AS stops`,
    )
      .bind(intentId, intentId)
      .first<{ jobs: number; stops: number }>();
    expect(failedDeliveryRows).toEqual({ jobs: 0, stops: 0 });
    await env.DB.prepare(
      "UPDATE inventory_balance SET on_hand=100000 WHERE location_id='location-cebu-central' AND inventory_pool_id=?",
    )
      .bind(fixture.poolId)
      .run();

    const recovered = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(recovered).toMatchObject({ applied: true, reason: "APPLIED" });
    const replay = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(replay).toMatchObject({
      applied: true,
      reason: "ALREADY_APPLIED",
      orderId: recovered.orderId,
    });
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM payment_intent WHERE id=?) AS intents, (SELECT COUNT(*) FROM payment_attempt WHERE payment_intent_id=?) AS attempts, (SELECT COUNT(*) FROM grocery_order WHERE payment_id=(SELECT id FROM payment_attempt WHERE payment_intent_id=?)) AS orders",
    )
      .bind(intentId, intentId, intentId)
      .first<{ intents: number; attempts: number; orders: number }>();
    expect(counts).toEqual({ intents: 1, attempts: 1, orders: 1 });
  });
});
