import { describe, expect, it, onTestFinished } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
import { getCustomerOrderDetail } from "./get-customer-order-detail";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { applyCheckoutPaymentReaction } from "./apply-checkout-payment-reaction";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";
import { createCheckoutPaymentIntent } from "../../payments/application/create-checkout-payment-intent";
import { reconcilePayment } from "../../payments/application/reconcile-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
} from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";

const deliveryProvider = createMockDeliveryProvider();
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

let counter = 0;

async function seededCheckout(
  options: {
    fulfillmentMode?: "INSTANT" | "SCHEDULED";
    onHand?: number;
    quantity?: number;
  } = {},
) {
  const n = ++counter;
  const customerId = `cust-co-${n}-${crypto.randomUUID().slice(0, 8)}`;
  const authId = `auth-${customerId}`;
  const now = Date.now();
  const fulfillmentMode = options.fulfillmentMode ?? "SCHEDULED";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode=?,cadence=?,version=version+1,updated_at=? WHERE id='global'",
    ).bind(fulfillmentMode, fulfillmentMode === "SCHEDULED" ? "WEEKLY" : null, now),
    env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET instant_promise_minutes=30,max_concurrent_instant_orders=20,dispatch_ready=1,updated_at=? WHERE location_id='location-cebu-central'",
    ).bind(now),
  ]);
  if (fulfillmentMode === "INSTANT") {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO service_fee_configuration
        (id,fee_type,flat_minor,percentage_basis_points,currency,effective_from,effective_to,version,reason,created_at)
       VALUES ('checkout-reaction-instant-fee','FLAT',500,0,'PHP',0,NULL,1,'test',0)`,
    ).run();
  }
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, authId, now, now)
    .run();
  const addressId = `addr-co-${n}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, delivery_zone_code, delivery_instructions_json, notes, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'R', '+639171234567', '{}', 10.3, 123.9, 'CEBU_CITY_CORE', ?, 'Legacy note must not win', 'active', 1, ?, ?)",
  )
    .bind(addressId, customerId, '{"gateGuard":"Ask guard"}', now, now)
    .run();

  // Dedicated product/pool/sku so sourcing and stock are test-controlled.
  const suffix = crypto.randomUUID().slice(0, 8);
  const poolId = `pool-co-${suffix}`;
  const productId = `product-co-${suffix}`;
  const skuId = `sku-co-${suffix}`;
  await env.DB.prepare(
    "INSERT INTO inventory_pool (id, base_unit_id, sourcing_mode, canonical_sourcing_mode, created_at, updated_at) VALUES (?, 'unit-gram', 'STOCKED', ?, 1, 1)",
  )
    .bind(poolId, "STOCKED")
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
  await env.DB.prepare(
    "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', 'AVAILABLE', 'PLANNED', 1)",
  )
    .bind(skuId)
    .run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES ('location-cebu-central', ?, ?, 0, 1)",
  )
    .bind(poolId, options.onHand ?? 100_000)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO price_version (id, sku_id, market_id, location_id, currency, amount_minor, price_type, valid_from, version, created_at) VALUES (?, ?, 'market-metro-cebu', 'location-cebu-central', 'PHP', 15000, 'STANDARD', 0, 1, 1)",
  )
    .bind(crypto.randomUUID(), skuId)
    .run();

  const cartId = `cart-co-${n}`;
  await env.DB.prepare(
    "INSERT INTO cart (id, customer_id, location_id, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'ACTIVE', 3, ?, ?)",
  )
    .bind(cartId, customerId, now, now)
    .run();
  await env.DB.prepare("INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, ?, ?)")
    .bind(cartId, skuId, options.quantity ?? 4)
    .run();

  return { customerId, cartId, addressId, skuId, poolId };
}

async function createQuote(
  fixture: Awaited<ReturnType<typeof seededCheckout>>,
  promotionCodes?: readonly string[],
) {
  const cycles = await env.DB.prepare(
    "SELECT id FROM delivery_cycle WHERE id='cycle-next-cebu' AND status='OPEN'",
  ).all<{ id: string }>();
  expect(cycles.results.length).toBeGreaterThan(0);
  const mode = await env.DB.prepare(
    "SELECT fulfillment_mode mode FROM global_commerce_configuration WHERE id='global'",
  ).first<{ mode: "INSTANT" | "SCHEDULED" }>();
  return createCheckoutQuote(
    env.DB,
    {
      customerId: fixture.customerId,
      cartId: fixture.cartId,
      cartVersion: 3,
      addressId: fixture.addressId,
      deliveryCycleId: mode?.mode === "INSTANT" ? null : cycles.results[0].id,
      promotionCodes,
      idempotencyKey: `quote-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    },
    quoteDependencies,
  );
}

async function intentWithReaction(quoteId: string, customerId: string, amountMinor = 65000) {
  const intentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, ?, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(intentId, quoteId, customerId, amountMinor, `pi-${intentId}`, Date.now(), Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?, ?)",
  )
    .bind(
      `attempt-${intentId}`,
      customerId,
      intentId,
      amountMinor,
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

function paymentCommandForQuote(
  customerId: string,
  quote: import("../../checkout/application/create-checkout-quote").CheckoutQuoteView,
) {
  return {
    customerId: customerId,
    headers: {},
    requestId: crypto.randomUUID(),
    checkoutAttemptId: quote.quoteId,
    expectedQuoteVersion: quote.attemptVersion,
    expectedPriceAcceptanceVersion: quote.priceAcceptanceVersion,
    expectedCurrency: quote.currency,
    expectedMerchandiseSubtotalMinor: quote.merchandiseSubtotalMinor,
    expectedItemDiscountMinor: quote.itemDiscountMinor,
    expectedOrderDiscountMinor: quote.orderDiscountMinor,
    expectedDeliverySubtotalMinor: quote.deliverySubtotalMinor,
    expectedDeliveryFeeMinor: quote.deliveryFeeMinor,
    expectedDeliveryDiscountMinor: quote.deliveryDiscountMinor,
    expectedTaxMinor: quote.taxMinor,
    expectedTotalMinor: quote.totalMinor,
    returnUrl: "https://freshmarkets.ph/checkout/payment",
    idempotencyKey: crypto.randomUUID(),
  };
}

describe("order commitment from canonical payment reactions", () => {
  it("carries an operator-created window through payment, recovery and the customer order without stock", async () => {
    const staff = await locationManager();
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('fulfillment.read','fulfillment.manage')",
    )
      .bind(staff.id)
      .run();
    const now = Date.now(),
      at = (hours: number) => new Date(now + hours * 3600000).toISOString();
    const draft = await exports.default.saveAdminDeliveryCycleDraft({
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      marketId: "market-metro-cebu",
      name: "Customer window journey",
      expectedVersion: 0,
      reason: "Plan tested fulfillment",
      orderOpensAt: at(-1),
      cutoffAt: at(24),
      procurementAt: at(25),
      preparationAt: at(28),
      pickupAt: at(30),
      windows: [
        { name: "Morning delivery", startsAt: at(31), endsAt: at(33) },
        { name: "Afternoon delivery", startsAt: at(34), endsAt: at(36) },
      ],
      participation: [{ zoneId: "zone-cebu-city-core", locationId: "location-cebu-central" }],
    });
    if (!draft.ok) throw new Error(draft.error.message);
    expect(
      await exports.default.scheduleAdminDeliveryCycle({
        headers: staff.headers,
        requestId: crypto.randomUUID(),
        cycleId: draft.value.cycleId,
        expectedVersion: 1,
        reason: "Publish checked windows",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await openDueDeliveryCycles(env.DB, now)).toBe(1);
    const window = draft.value.windows[1];
    if (!window) throw new Error("Missing afternoon window");
    const fixture = await seededCheckout({ onHand: 0 });
    const quoteCommand = {
      ...fixture,
      cartVersion: 3,
      deliveryCycleId: draft.value.cycleId,
      deliveryWindowId: window.windowId,
      fulfillmentOptionId: "operator-window-test",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    const quote = await createCheckoutQuote(env.DB, quoteCommand, quoteDependencies);
    if (!quote.ok) throw new Error(quote.error.message);
    expect(
      await createCheckoutQuote(
        env.DB,
        { ...quoteCommand, deliveryWindowId: draft.value.windows[0]?.windowId },
        quoteDependencies,
      ),
    ).toMatchObject({ ok: false });
    const provider = createMockPaymentProvider(),
      registry = new ProviderRegistry("test", [provider]);
    const payment = await createCheckoutPaymentIntent(
      env.DB,
      registry,
      "mock",
      quoteDependencies.routeDistance,
      paymentCommandForQuote(fixture.customerId, quote.value),
      quoteDependencies.deliveryProviders,
    );
    if (!payment.ok) throw new Error(payment.error.message);
    const attempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ provider_reference: string }>();
    if (!attempt) throw new Error("Payment not started");
    setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
    expect(
      await reconcilePayment(env.DB, registry, {
        paymentIntentId: payment.value.paymentIntentId,
        idempotencyKey: crypto.randomUUID(),
        actorId: "test",
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const reaction = await env.DB.prepare(
      "SELECT id FROM payment_reaction WHERE payment_intent_id=? AND reaction_type='COMMIT_ORDER'",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ id: string }>();
    if (!reaction) throw new Error("Missing payment reaction");
    const command = {
      reactionId: reaction.id,
      paymentIntentId: payment.value.paymentIntentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    await env.DB.exec(
      "CREATE TRIGGER ignore_window_snapshot BEFORE INSERT ON order_delivery_window_snapshot BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await applyCheckoutPaymentReaction(env.DB, command)).toMatchObject({ applied: false });
      expect(
        await env.DB.prepare("SELECT count(*) count FROM grocery_order WHERE customer_id=?")
          .bind(fixture.customerId)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_window_snapshot");
    }
    const committed = await applyCheckoutPaymentReaction(env.DB, command);
    expect(committed).toMatchObject({ applied: true });
    if (!committed.orderId) throw new Error("Order not committed");
    expect(await applyCheckoutPaymentReaction(env.DB, command)).toEqual({
      ...committed,
      reason: "ALREADY_APPLIED",
    });
    expect(
      await getCustomerOrderDetail(env.DB, {
        customerId: fixture.customerId,
        orderId: committed.orderId,
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({
      ok: true,
      value: {
        fulfillment: {
          deliveryWindow: {
            name: window.name,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            timezone: "Asia/Manila",
          },
        },
      },
    });
    expect(
      await env.DB.prepare("SELECT pickup_at FROM order_delivery_window_snapshot WHERE order_id=?")
        .bind(committed.orderId)
        .first(),
    ).toEqual({ pickup_at: Date.parse(at(30)) });
    expect(
      await env.DB.prepare(
        "SELECT on_hand,reserved FROM inventory_balance WHERE inventory_pool_id=?",
      )
        .bind(fixture.poolId)
        .first(),
    ).toEqual({ on_hand: 0, reserved: 0 });
    await expect(
      env.DB.prepare("UPDATE order_delivery_window_snapshot SET name='Changed' WHERE order_id=?")
        .bind(committed.orderId)
        .run(),
    ).rejects.toThrow();
  });
  it.each(["revision", "expiry", "cutoff"])(
    "rejects %s changes during provider revalidation before creating a payment intent",
    async (change) => {
      const fixture = await seededCheckout({ onHand: 0 });
      const quote = await createQuote(fixture);
      if (!quote.ok) throw new Error(quote.error.message);
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
      const cycles = await env.DB.prepare("SELECT id,status,version FROM delivery_cycle").all<{
        id: string;
        status: string;
        version: number;
      }>();
      onTestFinished(async () => {
        await env.DB.batch([
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
      const changedProvider = {
        ...deliveryProvider,
        quote: async (...args: Parameters<typeof deliveryProvider.quote>) => {
          reachedProvider = true;
          const sql =
            change === "revision"
              ? "UPDATE geography_configuration SET version=version+1 WHERE market_id='market-metro-cebu'"
              : change === "expiry"
                ? "UPDATE location_serviceability SET valid_to=1"
                : "UPDATE delivery_cycle SET status='CLOSED',version=version+1 WHERE status='OPEN'";
          await env.DB.prepare(sql).run();
          return deliveryProvider.quote(...args);
        },
      };
      const result = await createCheckoutPaymentIntent(
        env.DB,
        new ProviderRegistry("test", [createMockPaymentProvider()]),
        "mock",
        quoteDependencies.routeDistance,
        paymentCommandForQuote(fixture.customerId, quote.value),
        new Map([["lalamove", changedProvider]]),
      );
      expect(reachedProvider).toBe(true);
      expect(result).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM payment_intent WHERE customer_id=?")
          .bind(fixture.customerId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM payment_attempt WHERE customer_id=?")
          .bind(fixture.customerId)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it("keeps one benefit per component in Core even though storage can represent a larger stack", async () => {
    const fixture = await seededCheckout();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids)
      await env.DB.prepare(`INSERT INTO promotion
      (id,code,name,description,status,benefit_type,discount_minor,minimum_minor,starts_at,automatic,priority,version,created_at,updated_at)
      VALUES (?,?,'Stack test','','ACTIVE','ORDER_FIXED_DISCOUNT',1000,0,0,0,0,1,1,1)`)
        .bind(id, id.toUpperCase())
        .run();
    const quote = await createQuote(
      fixture,
      ids.map((id) => id.toUpperCase()),
    );
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    expect(quote.value.promotionApplications).toHaveLength(1);
    const application = quote.value.promotionApplications[0];
    if (!application) throw new Error("Missing benefit");
    const extra = ids.find((id) => id !== application.promotionId);
    if (!extra) throw new Error("Missing extra promotion");
    // Direct persistence represents a future stacking policy. Today's Core
    // must reject this evidence, even after the component uniqueness is gone.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO checkout_promotion_claim
        (id,checkout_quote_id,promotion_id,customer_id,price_component,benefit_type,amount_minor,definition_version,grant_id,snapshot_json,status,created_at)
        SELECT ?,checkout_quote_id,?,customer_id,price_component,benefit_type,amount_minor,definition_version,grant_id,snapshot_json,status,created_at
        FROM checkout_promotion_claim WHERE checkout_quote_id=?`).bind(
        crypto.randomUUID(),
        extra,
        quote.value.quoteId,
      ),
      env.DB.prepare("UPDATE checkout_quote SET promotion_applications_json=? WHERE id=?").bind(
        JSON.stringify([application, { ...application, promotionId: extra }]),
        quote.value.quoteId,
      ),
    ]);
    const payment = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
      quote.value.totalMinor,
    );
    expect(
      await applyCheckoutPaymentReaction(env.DB, {
        reactionId: payment.reactionId,
        paymentIntentId: payment.intentId,
        checkoutAttemptId: quote.value.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ).toMatchObject({ applied: false, reason: "QUOTE_UNUSABLE" });
    expect(
      await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM grocery_order WHERE customer_id=?) AS orders,
      (SELECT COUNT(*) FROM promotion_redemption WHERE customer_id=?) AS redemptions,
      (SELECT COUNT(*) FROM checkout_promotion_claim WHERE checkout_quote_id=? AND status='COMMITTED') AS claims`)
        .bind(fixture.customerId, fixture.customerId, quote.value.quoteId)
        .first(),
    ).toEqual({ orders: 0, redemptions: 0, claims: 0 });
  });
  it("snapshots a promotion claim without redemption, then redeems it once at commitment", async () => {
    const fixture = await seededCheckout();
    const promotionId = `promotion-${crypto.randomUUID()}`;
    const code = `SAVE${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO promotion (
        id, code, name, description, status, benefit_type, discount_minor, percent,
        minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit,
        automatic, priority, version, created_at, updated_at
      ) VALUES (?, ?, 'Checkout saving', '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', 5000, NULL,
                0, ?, NULL, 10, 1, 0, 0, 1, ?, ?)`,
    )
      .bind(promotionId, code, now - 1, now, now)
      .run();

    const quote = await createQuote(fixture, [code.toLowerCase()]);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    expect(quote.value).toMatchObject({
      orderDiscountMinor: 5000,
      requestedPromotionCodes: [code],
      promotionApplications: [{ promotionId, component: "MERCHANDISE", amountMinor: 5000 }],
    });
    const before = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM checkout_promotion_claim WHERE checkout_quote_id=?) AS claims, (SELECT COUNT(*) FROM promotion_redemption WHERE promotion_id=?) AS redemptions",
    )
      .bind(quote.value.quoteId, promotionId)
      .first<{ claims: number; redemptions: number }>();
    expect(before).toEqual({ claims: 1, redemptions: 0 });

    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
      quote.value.totalMinor,
    );
    const command = {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    const first = await applyCheckoutPaymentReaction(env.DB, command);
    expect(first).toMatchObject({ applied: true, reason: "APPLIED" });
    const identity = await env.DB.prepare(
      "SELECT order_number, committed_at FROM grocery_order WHERE id=?",
    )
      .bind(first.orderId)
      .first<{ order_number: string | null; committed_at: number | null }>();
    expect(identity?.order_number).toMatch(/^FM-\d{4}-[A-F0-9]{12}$/);
    expect(identity?.committed_at).toEqual(expect.any(Number));
    const invoice = await env.DB.prepare(
      "SELECT status,payment_intent_id,financial_snapshot_json,buyer_snapshot_json,blocked_reason FROM order_invoice_readiness WHERE order_id=?",
    )
      .bind(first.orderId)
      .first<{
        status: string;
        payment_intent_id: string;
        financial_snapshot_json: string;
        buyer_snapshot_json: string;
        blocked_reason: string | null;
      }>();
    expect(invoice).toMatchObject({
      status: "PENDING_TAX_CONFIGURATION",
      payment_intent_id: intentId,
      blocked_reason: "APPROVED_TAX_CONFIGURATION_REQUIRED",
    });
    expect(JSON.parse(invoice?.financial_snapshot_json ?? "{}").totalMinor).toBe(
      quote.value.totalMinor,
    );
    const replay = await applyCheckoutPaymentReaction(env.DB, command);
    expect(replay).toEqual({ ...first, reason: "ALREADY_APPLIED" });
    const after = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM promotion_redemption WHERE promotion_id=?) AS redemptions, (SELECT COUNT(*) FROM order_promotion_application WHERE promotion_id=?) AS applications, (SELECT status FROM checkout_promotion_claim WHERE checkout_quote_id=?) AS claim_status",
    )
      .bind(promotionId, promotionId, quote.value.quoteId)
      .first<{ redemptions: number; applications: number; claim_status: string }>();
    expect(after).toEqual({ redemptions: 1, applications: 1, claim_status: "COMMITTED" });
  });

  it.each(["global", "customer", "grant", "system-grant"])(
    "atomically enforces %s promotion limits across competing paid commitments",
    async (limit) => {
      const firstFixture = await seededCheckout();
      const secondFixture = await seededCheckout();
      const promotionId = `limited-${crypto.randomUUID()}`;
      const code = `LIMITED${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO promotion (
        id, code, name, description, status, benefit_type, discount_minor, percent,
        minimum_minor, starts_at, ends_at, global_usage_limit, per_customer_usage_limit,
        automatic, priority, version, created_at, updated_at
      ) VALUES (?, ?, 'Limited', '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', 1000, NULL,
                0, ?, NULL, ?, ?, 0, 0, 1, ?, ?)`,
      )
        .bind(
          promotionId,
          code,
          now - 1,
          limit === "global" ? 1 : null,
          limit === "customer" ? 1 : null,
          now,
          now,
        )
        .run();
      if (limit === "grant" || limit === "system-grant") {
        await env.DB.prepare(`INSERT INTO promotion_grant
        (id,benefit_code,benefit_type,max_redemptions,status,customer_id,parameters_json,created_at,updated_at)
        VALUES (?,?,'ORDER_FIXED_DISCOUNT',1,'ACTIVE',?,'{}',?,?)`)
          .bind(
            limit === "grant" ? `targeted-${promotionId}` : `order-promotion-${promotionId}`,
            code,
            limit === "grant" ? firstFixture.customerId : null,
            now,
            now,
          )
          .run();
      }
      const firstQuote = await createQuote(firstFixture, [code]);
      if (limit === "customer" || limit === "grant") {
        secondFixture.customerId = firstFixture.customerId;
        await env.DB.batch([
          env.DB.prepare("UPDATE cart SET status='ABANDONED' WHERE id=?").bind(firstFixture.cartId),
          env.DB.prepare("UPDATE cart SET customer_id=? WHERE id=?").bind(
            firstFixture.customerId,
            secondFixture.cartId,
          ),
          env.DB.prepare("UPDATE customer_address SET customer_id=? WHERE id=?").bind(
            firstFixture.customerId,
            secondFixture.addressId,
          ),
        ]);
      }
      const secondQuote = await createQuote(secondFixture, [code]);
      if (!firstQuote.ok || !secondQuote.ok) throw new Error("quote fixture failed");
      const firstPayment = await intentWithReaction(
        firstQuote.value.quoteId,
        firstFixture.customerId,
        firstQuote.value.totalMinor,
      );
      const secondPayment = await intentWithReaction(
        secondQuote.value.quoteId,
        secondFixture.customerId,
        secondQuote.value.totalMinor,
      );
      const commands = [
        {
          reactionId: firstPayment.reactionId,
          paymentIntentId: firstPayment.intentId,
          checkoutAttemptId: firstQuote.value.quoteId,
          canonicalPaymentState: "SUCCEEDED" as const,
        },
        {
          reactionId: secondPayment.reactionId,
          paymentIntentId: secondPayment.intentId,
          checkoutAttemptId: secondQuote.value.quoteId,
          canonicalPaymentState: "SUCCEEDED" as const,
        },
      ];
      const outcomes = await Promise.all(
        commands.map((command) => applyCheckoutPaymentReaction(env.DB, command)),
      );
      expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
      const loserIndex = outcomes.findIndex((outcome) => !outcome.applied);
      expect(outcomes[loserIndex]).toMatchObject({ applied: false, reason: "CAS_CONFLICT" });
      const loser = commands[loserIndex];
      const counts = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM promotion_redemption WHERE promotion_id=?) AS redemptions,
        (SELECT COUNT(*) FROM order_payment_reaction WHERE payment_intent_id=?) AS losing_reactions,
        (SELECT COUNT(*) FROM grocery_order WHERE payment_id=?) AS losing_orders,
        (SELECT COUNT(*) FROM order_promotion_application WHERE promotion_id=?) AS applications,
        (SELECT status FROM checkout_promotion_claim WHERE checkout_quote_id=?) AS losing_claim`,
      )
        .bind(
          promotionId,
          loser.paymentIntentId,
          `attempt-${loser.paymentIntentId}`,
          promotionId,
          loser.checkoutAttemptId,
        )
        .first();
      expect(counts).toEqual({
        redemptions: 1,
        losing_reactions: 0,
        losing_orders: 0,
        applications: 1,
        losing_claim: "UNCOMMITTED",
      });
      const winner = commands[1 - loserIndex];
      expect(await applyCheckoutPaymentReaction(env.DB, winner)).toMatchObject({
        applied: true,
        reason: "ALREADY_APPLIED",
      });
    },
  );
  it("rejects a scheduled basket below the market minimum", async () => {
    const fixture = await seededCheckout({ quantity: 1 });

    const quote = await createQuote(fixture);

    expect(quote).toMatchObject({ ok: false, error: { code: "MINIMUM_ORDER_NOT_MET" } });
    const persisted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_quote WHERE cart_id=?",
    )
      .bind(fixture.cartId)
      .first<{ count: number }>();
    expect(persisted?.count).toBe(0);
  });

  it("allows quote creation without any subscription", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);

    expect(quote.ok).toBe(true);
  });

  it("commits paid Scheduled demand without subscription or stock and replays once", async () => {
    const fixture = await seededCheckout({ onHand: 0 });
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const provider = createMockPaymentProvider();
    const registry = new ProviderRegistry("test", [provider]);
    const paymentCommand = paymentCommandForQuote(fixture.customerId, quote.value);
    const startPayment = () =>
      createCheckoutPaymentIntent(
        env.DB,
        registry,
        "mock",
        quoteDependencies.routeDistance,
        paymentCommand,
        quoteDependencies.deliveryProviders,
      );
    const payment = await startPayment();
    if (!payment.ok) throw new Error(payment.error.message);
    expect(await startPayment()).toEqual(payment);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE geography_configuration SET version=version+1 WHERE market_id='market-metro-cebu'",
      ),
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='PAUSED',version=version+1 WHERE id='global'",
      ),
    ]);
    expect(await startPayment()).toEqual(payment);
    const intentId = payment.value.paymentIntentId;
    const attempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ provider_reference: string }>();
    if (!attempt) throw new Error("Missing payment attempt");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM order_payment_reaction WHERE payment_intent_id=?",
      )
        .bind(intentId)
        .first(),
    ).toEqual({ count: 0 });
    setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
    expect(
      await reconcilePayment(env.DB, registry, {
        paymentIntentId: intentId,
        idempotencyKey: crypto.randomUUID(),
        actorId: "test",
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const reaction = await env.DB.prepare(
      "SELECT id FROM payment_reaction WHERE payment_intent_id=? AND reaction_type='COMMIT_ORDER'",
    )
      .bind(intentId)
      .first<{ id: string }>();
    if (!reaction) throw new Error("Missing canonical payment reaction");
    const reactionId = reaction.id;

    const outcome = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quote.value.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });

    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    expect(
      await applyCheckoutPaymentReaction(env.DB, {
        reactionId,
        paymentIntentId: intentId,
        checkoutAttemptId: quote.value.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ).toEqual({ applied: true, reason: "ALREADY_APPLIED", orderId: outcome.orderId });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM subscription WHERE customer_id=?")
        .bind(fixture.customerId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT on_hand,reserved FROM inventory_balance WHERE inventory_pool_id=?",
      )
        .bind(fixture.poolId)
        .first(),
    ).toEqual({ on_hand: 0, reserved: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count,SUM(quantity_base_total) quantity FROM committed_demand WHERE order_id=?",
      )
        .bind(outcome.orderId)
        .first(),
    ).toEqual({ count: 1, quantity: 2000 });
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

  it("commits once from SUCCEEDED with Scheduled snapshots and demand", async () => {
    const fixture = await seededCheckout();
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
      total_minor: 65000,
      merchandise_subtotal_minor: 60000,
      item_discount_minor: 0,
      order_discount_minor: 0,
      delivery_subtotal_minor: 5000,
      delivery_discount_minor: 0,
      service_fee_minor: 0,
      tax_minor: 0,
    });
    const quoteSnapshot = await env.DB.prepare(
      "SELECT cycle_snapshot_json FROM checkout_quote WHERE id=?",
    )
      .bind(quote.value.quoteId)
      .first<{ cycle_snapshot_json: string }>();
    const fulfillmentSnapshot = await env.DB.prepare(
      "SELECT cutoff_at, delivery_date FROM order_fulfillment_snapshot WHERE order_id=?",
    )
      .bind(outcome.orderId)
      .first<{ cutoff_at: number; delivery_date: number }>();
    const expectedCycle = JSON.parse(quoteSnapshot!.cycle_snapshot_json) as {
      cutoffAt: string;
      deliveryDate: string;
    };
    expect(fulfillmentSnapshot).toEqual({
      cutoff_at: Date.parse(expectedCycle.cutoffAt),
      delivery_date: Date.parse(expectedCycle.deliveryDate),
    });
    const items = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_item WHERE order_id=? AND base_quantity=2000",
    )
      .bind(outcome.orderId)
      .first<{ count: number }>();
    expect(items?.count).toBe(1);
    const logisticsSnapshot = await env.DB.prepare(
      "SELECT base_unit_code_snapshot AS baseUnitCode, shipping_weight_grams AS shippingWeightGrams FROM order_item WHERE order_id=?",
    )
      .bind(outcome.orderId)
      .first<{ baseUnitCode: string | null; shippingWeightGrams: number | null }>();
    expect(logisticsSnapshot).toEqual({ baseUnitCode: "GRAM", shippingWeightGrams: 2_000 });
    const reservations = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
    )
      .bind(outcome.orderId, fixture.poolId)
      .first<{ total: number }>();
    expect(reservations?.total).toBe(0);
    const demand = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM committed_demand WHERE order_id=?",
    )
      .bind(outcome.orderId)
      .first<{ count: number }>();
    expect(demand?.count).toBe(1);
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
      contact_snapshot_json: '{"recipient":"R","phone":"+639171234567"}',
      instructions_snapshot: '{"gateGuard":"Ask guard"}',
      status: "UNASSIGNED",
    });
    expect(delivery?.job_id).toBeTypeOf("string");
    expect(delivery?.stop_id).toBeTypeOf("string");
    expect(JSON.parse(String(delivery?.address_snapshot_json))).toMatchObject({
      recipient: "R",
      phone: "+639171234567",
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

  it("creates all committed demand in Scheduled mode regardless of legacy sourcing", async () => {
    const planned = await seededCheckout();
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

    const hybrid = await seededCheckout({ onHand: 1500 });
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
    expect(reservationTotal?.total).toBe(0);
    expect(demandTotal?.total).toBe(2000);
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

  it("commits exact Scheduled demand without consulting or mutating legacy capacity", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const storedQuote = await env.DB.prepare(
      "SELECT delivery_cycle_id, cycle_snapshot_json FROM checkout_quote WHERE id=?",
    )
      .bind(quote.value.quoteId)
      .first<{ delivery_cycle_id: string; cycle_snapshot_json: string }>();
    const route = JSON.parse(storedQuote!.cycle_snapshot_json) as {
      zoneId: string;
      locationId: string;
    };
    const original = await env.DB.prepare(
      "SELECT capacity, allocated FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
    )
      .bind(storedQuote!.delivery_cycle_id, route.zoneId, route.locationId)
      .first<{ capacity: number; allocated: number }>();
    await env.DB.prepare(
      "UPDATE cycle_zone_capacity SET allocated=capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
    )
      .bind(storedQuote!.delivery_cycle_id, route.zoneId, route.locationId)
      .run();
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
    );

    try {
      const outcome = await applyCheckoutPaymentReaction(env.DB, {
        reactionId,
        paymentIntentId: intentId,
        checkoutAttemptId: quote.value.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      });

      expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
      const orderCount = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM order_payment_reaction WHERE checkout_quote_id=?",
      )
        .bind(quote.value.quoteId)
        .first<{ count: number }>();
      expect(orderCount?.count).toBe(1);
      const storedStatus = await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(quote.value.quoteId)
        .first<{ status: string }>();
      expect(storedStatus?.status).toBe("CONSUMED");
      const exactDemand = await env.DB.prepare(
        `SELECT demand_basis,sku_id,quantity_sellable,quantity_base_total,shipping_weight_grams
         FROM committed_demand WHERE order_id=?`,
      )
        .bind(outcome.orderId)
        .first();
      expect(exactDemand).toMatchObject({
        demand_basis: "EXACT_PAID_LINE",
        sku_id: fixture.skuId,
        quantity_sellable: 4,
        quantity_base_total: 2_000,
        shipping_weight_grams: 2_000,
      });
      const unchangedCapacity = await env.DB.prepare(
        "SELECT allocated FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id=? AND location_id=?",
      )
        .bind(storedQuote!.delivery_cycle_id, route.zoneId, route.locationId)
        .first<{ allocated: number }>();
      expect(unchangedCapacity?.allocated).toBe(original!.capacity);
    } finally {
      await env.DB.prepare(
        "UPDATE cycle_zone_capacity SET capacity=?, allocated=? WHERE cycle_id=? AND zone_id=? AND location_id=?",
      )
        .bind(
          original!.capacity,
          original!.allocated,
          storedQuote!.delivery_cycle_id,
          route.zoneId,
          route.locationId,
        )
        .run();
    }
  });

  it("commits only one order when two successful payments race for one quote", async () => {
    const fixture = await seededCheckout();
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const first = await intentWithReaction(quote.value.quoteId, fixture.customerId);
    const second = await intentWithReaction(quote.value.quoteId, fixture.customerId);

    const outcomes = await Promise.all([
      applyCheckoutPaymentReaction(env.DB, {
        reactionId: first.reactionId,
        paymentIntentId: first.intentId,
        checkoutAttemptId: quote.value.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
      applyCheckoutPaymentReaction(env.DB, {
        reactionId: second.reactionId,
        paymentIntentId: second.intentId,
        checkoutAttemptId: quote.value.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
    const orderCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_payment_reaction WHERE checkout_quote_id=?",
    )
      .bind(quote.value.quoteId)
      .first<{ count: number }>();
    expect(orderCount?.count).toBe(1);
  });

  it("retries a paid commitment with the same identities after stock recovers", async () => {
    const fixture = await seededCheckout({
      fulfillmentMode: "INSTANT",
      onHand: 100_000,
    });
    const quote = await createQuote(fixture);
    if (!quote.ok) throw new Error(JSON.stringify(quote.error));
    const { intentId, reactionId } = await intentWithReaction(
      quote.value.quoteId,
      fixture.customerId,
      quote.value.totalMinor,
    );
    await env.DB.prepare(
      "UPDATE inventory_balance SET on_hand=0 WHERE location_id='location-cebu-central' AND inventory_pool_id=?",
    )
      .bind(fixture.poolId)
      .run();

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
