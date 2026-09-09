import { describe, expect, it, vi, onTestFinished } from "vitest";
import { createPayment } from "../../payments/application/create-payment";
import { redrivePaymentReactions } from "../../payments/application/redrive-payment-reactions";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import {
  createMockPaymentProvider,
  setMockRefundObservation,
} from "../../payments/infrastructure/providers/mock-payment-provider";
import { requestRefund } from "../../payments/application/request-refund";
import { reconcileRefunds } from "../../payments/application/reconcile-refunds";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { startPromotionalTrial } from "../../membership/application/start-promotional-trial";
import { applyCheckoutPaymentReaction } from "./apply-checkout-payment-reaction";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";
import { adjustInventory } from "../../inventory/application/adjust-inventory";
import { advanceFulfillment } from "../../operations/application/advance-fulfillment";
import { requestOrderCancellation } from "./cancel-order";
import { getProduct } from "../../catalog/service";
import { getCart } from "../../checkout/application/cart";
import { abandonCheckoutAttempt } from "../../checkout/application/abandon-checkout-attempt";

const LOCATION = "location-cebu-central";
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
const ZONE_CODE = "CEBU_CITY_CORE";
let counter = 0;

async function configureInstant(maxOrders = 25): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO service_fee_configuration
      (id, fee_type, flat_minor, percentage_basis_points, currency,
       effective_from, effective_to, version, reason, created_at)
     VALUES ('instant-commit-fee-v1', 'MIXED', 500, 300, 'PHP', ?, NULL, 1, 'test fee', ?)`,
  )
    .bind(now - 1_000, now)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET instant_promise_minutes=60,max_concurrent_instant_orders=?,dispatch_ready=1,version=version+1,updated_at=? WHERE location_id=?",
    ).bind(maxOrders, now, LOCATION),
    env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1,updated_at=? WHERE id='global'",
    ).bind(now),
  ]);
}

async function seededInstantQuote(
  member = true,
  secondPool = false,
  promotionCodes: readonly string[] = [],
  quantity = 5,
): Promise<{ quoteId: string; customerId: string }> {
  const customerId = `cust-cmt-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  if (member) {
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
  }
  const addressId = `addr-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, service_area_code, delivery_zone_code, notes, status, version, created_at, updated_at) VALUES (?, ?, 'Home', 'C', '+639171234567', '{}', 10.32, 123.9, 'CEBU_CITY', ?, 'Call on arrival', 'active', 1, ?, ?)",
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
    .bind(cartId, quantity)
    .run();
  if (secondPool) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, 'sku-potato-500g', 2)",
      ).bind(cartId),
      env.DB.prepare(
        "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved) VALUES (?, 'pool-potato', 1000000, 0) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=1000000",
      ).bind(LOCATION),
    ]);
  }
  await env.DB.prepare(
    "UPDATE inventory_pool SET canonical_sourcing_mode='STOCKED' WHERE id='pool-red-onion'",
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
      promotionCodes,
      addressId,
      deliveryCycleId: null,
      fulfillmentOptionId: "opaque-lalamove-option",
      deliveryPartner: {
        code: "lalamove",
        displayName: "Lalamove",
        serviceType: "MOTORCYCLE",
        serviceLabel: "Motorcycle",
      },
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

async function refundedUncommittedFixture(partial = false) {
  await configureInstant();
  const { quoteId, customerId } = await seededInstantQuote(false, true);
  const { intentId, reactionId } = await seedReaction(quoteId);
  await env.DB.exec(
    "CREATE TRIGGER fail_refunded_commit BEFORE INSERT ON grocery_order BEGIN SELECT RAISE(ABORT,'TEST_COMMIT_FAILURE'); END",
  );
  try {
    expect(
      await applyCheckoutPaymentReaction(env.DB, {
        reactionId,
        paymentIntentId: intentId,
        checkoutAttemptId: quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ).toMatchObject({ applied: false });
  } finally {
    await env.DB.exec("DROP TRIGGER fail_refunded_commit");
  }
  await env.DB.prepare("UPDATE payment_reaction SET attempts=5,available_at=0 WHERE id=?")
    .bind(reactionId)
    .run();
  const provider = createMockPaymentProvider(),
    registry = new ProviderRegistry("test", [provider]);
  await redrivePaymentReactions(env.DB, registry, Date.now());
  const record = await env.DB.prepare(
    "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
  )
    .bind(intentId)
    .first<{ id: string; version: number }>();
  const payment = await env.DB.prepare("SELECT amount_minor FROM payment_intent WHERE id=?")
    .bind(intentId)
    .first<{ amount_minor: number }>();
  if (!record || !payment) throw new Error("Missing failed commitment evidence");
  async function refund(amountMinor: number) {
    const key = crypto.randomUUID();
    const accepted = await requestRefund(env.DB, registry, {
      paymentIntentId: intentId,
      amountMinor,
      reason: "Unable to commit paid groceries",
      idempotencyKey: key,
      actorId: "finance-test",
      requestId: crypto.randomUUID(),
    });
    expect(accepted).toMatchObject({ ok: true });
    if (!provider.lookupRefund) throw new Error("Missing mock refund lookup");
    const observation = await provider.lookupRefund({
      providerReference: `mock_pay_${intentId}`,
      providerRefundReference: null,
      refundProviderIdempotencyKey: key,
    });
    if (observation.outcome !== "FOUND")
      throw new Error("Missing actual test-provider refund acceptance");
    setMockRefundObservation(provider, key, {
      outcome: "FOUND",
      refund: { ...observation.refund, canonicalState: "SUCCEEDED", observedAt: Date.now() },
    });
    await reconcileRefunds(env.DB, registry, Date.now() + 120000);
  }
  await refund(payment.amount_minor - (partial ? 1 : 0));
  const manager = await locationManager("global");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
  )
    .bind(manager.id)
    .run();
  return {
    quoteId,
    customerId,
    intentId,
    reactionId,
    refund,
    command: {
      headers: manager.headers,
      caseId: record.id,
      expectedVersion: record.version,
      reason: "Confirmed the original payment was fully refunded without an Order",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    },
  };
}

describe("instant order commitment", () => {
  it("holds item-sale quantities, preserves paid prices after stopping, and restores only with cancellation stock release", async () => {
    await configureInstant();
    await env.DB.prepare(
      "UPDATE inventory_balance SET on_hand=1000000 WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
    )
      .bind(LOCATION)
      .run();
    const manager = await locationManager();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.manage','promotions.read','inventory.adjust')",
    )
      .bind(manager.id)
      .run();
    const meta = { headers: manager.headers, requestId: crypto.randomUUID() };
    const ids: string[] = [];
    onTestFinished(async () => {
      for (const promotionId of ids) {
        const row = await env.DB.prepare("SELECT version,status FROM promotion WHERE id=?")
          .bind(promotionId)
          .first<{ version: number; status: string }>();
        if (row?.status === "ACTIVE")
          await exports.default.changeAdminPromotionStatus({
            ...meta,
            promotionId,
            expectedVersion: row.version,
            action: "DEACTIVATE",
            reason: "End test sale",
            idempotencyKey: crypto.randomUUID(),
          });
      }
    });
    const definition = {
      ...meta,
      code: `SALE_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
      name: "Onion sale",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT" as const,
      discountMinor: 100,
      minimumMinor: 0,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      productTargets: [{ skuId: "sku-red-onion-500g", locationId: LOCATION, quantityLimit: 5 }],
      idempotencyKey: crypto.randomUUID(),
    };
    const created = await exports.default.createAdminPromotion(definition);
    if (!created.ok) throw new Error(created.error.message);
    const saleId = created.value.promotionId;
    ids.push(saleId);
    expect(created.value.productTargets).toMatchObject([
      { quantityLimit: 5, remainingQuantity: 5 },
    ]);
    expect(await exports.default.createAdminPromotion(definition)).toEqual(created);
    const activated = await exports.default.changeAdminPromotionStatus({
      ...meta,
      promotionId: saleId,
      expectedVersion: created.value.version,
      action: "ACTIVATE",
      reason: "Start sale",
      idempotencyKey: crypto.randomUUID(),
    });
    if (!activated.ok) throw new Error(activated.error.message);
    const publicSale = (await getProduct(env.DB, "red-onion", LOCATION))?.product.variants.find(
      (variant) => variant.id === "sku-red-onion-500g",
    );
    expect(publicSale?.sale).toMatchObject({
      promotionId: saleId,
      priceMinor: publicSale!.priceMinor! - 100,
      remainingQuantity: 5,
    });
    expect(
      await exports.default.previewAdminPromotion({
        ...meta,
        promotionId: saleId,
        subtotalMinor: 10000,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const overlap = await exports.default.createAdminPromotion({
      ...definition,
      code: `OTHER_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!overlap.ok) throw new Error(overlap.error.message);
    ids.push(overlap.value.promotionId);
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId: overlap.value.promotionId,
        expectedVersion: 1,
        action: "ACTIVATE",
        reason: "Try overlap",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT status FROM promotion WHERE id=?")
        .bind(overlap.value.promotionId)
        .first(),
    ).toEqual({ status: "DRAFT" });
    const groceryCode = `GROCERY_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    const grocery = await exports.default.createAdminPromotion({
      ...definition,
      code: groceryCode,
      name: "Full-price groceries",
      benefitType: "ORDER_PERCENT_DISCOUNT",
      discountMinor: undefined,
      percent: 10,
      productTargets: [],
      idempotencyKey: crypto.randomUUID(),
    });
    if (!grocery.ok) throw new Error(grocery.error.message);
    ids.push(grocery.value.promotionId);
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId: grocery.value.promotionId,
        expectedVersion: 1,
        action: "ACTIVATE",
        reason: "Start full-price grocery code",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const { quoteId, customerId } = await seededInstantQuote(false, true, [groceryCode]);
    expect(
      await env.DB.prepare("SELECT item_discount_minor FROM checkout_quote WHERE id=?")
        .bind(quoteId)
        .first(),
    ).toEqual({ item_discount_minor: 500 });
    const fullPriceBasis = await env.DB.prepare(
      "SELECT json_extract(line.value,'$.lineTotalMinor') line_subtotal_minor FROM checkout_quote quote, json_each(quote.lines_json) line WHERE quote.id=? AND json_extract(line.value,'$.skuId')='sku-potato-500g'",
    )
      .bind(quoteId)
      .first<{ line_subtotal_minor: number }>();
    expect(
      await env.DB.prepare("SELECT order_discount_minor FROM checkout_quote WHERE id=?")
        .bind(quoteId)
        .first(),
    ).toEqual({ order_discount_minor: Math.floor(fullPriceBasis!.line_subtotal_minor / 10) });
    const cartView = await getCart(env.DB, {
      customerId,
      headers: {},
      requestId: crypto.randomUUID(),
    });
    if (!cartView.ok) throw new Error(cartView.error.message);
    const cartOnion = cartView.value.items.find((item) => item.skuId === "sku-red-onion-500g")!;
    expect(cartOnion.regularLineTotalMinor! - cartOnion.lineTotalMinor!).toBe(500);
    expect(
      (await getProduct(env.DB, "red-onion", LOCATION))?.product.variants.find(
        (variant) => variant.id === "sku-red-onion-500g",
      )?.sale,
    ).toBeUndefined();
    const second = await seededInstantQuote(false);
    expect(
      await env.DB.prepare("SELECT item_discount_minor FROM checkout_quote WHERE id=?")
        .bind(second.quoteId)
        .first(),
    ).toEqual({ item_discount_minor: 0 });
    const { intentId, reactionId } = await seedReaction(quoteId);
    for (const paymentState of ["PROCESSING", "SUCCEEDED"]) {
      await env.DB.prepare("UPDATE payment_intent SET status=? WHERE id=?")
        .bind(paymentState, intentId)
        .run();
      expect(
        await createCheckoutQuote(
          env.DB,
          {
            customerId,
            cartId: `cart-${customerId}`,
            cartVersion: 1,
            addressId: `addr-${customerId}`,
            deliveryCycleId: null,
            fulfillmentOptionId: "opaque-lalamove-option",
            idempotencyKey: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
          },
          quoteDependencies,
        ),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
        )
          .bind(quoteId)
          .first(),
      ).toEqual({ n: 2 });
      expect(
        await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?").bind(quoteId).first(),
      ).toEqual({ status: "ACTIVE" });
    }
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId: saleId,
        expectedVersion: activated.value.version,
        action: "DEACTIVATE",
        reason: "Stop new sales",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const input = {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    const committed = await applyCheckoutPaymentReaction(env.DB, input);
    if (!committed.applied || !committed.orderId)
      throw new Error("Discounted order did not commit");
    expect(await applyCheckoutPaymentReaction(env.DB, input)).toMatchObject({
      applied: true,
      orderId: committed.orderId,
    });
    const remaining = () =>
      env.DB.prepare("SELECT remaining_quantity FROM promotion_product_target WHERE promotion_id=?")
        .bind(saleId)
        .first();
    expect(await remaining()).toEqual({ remaining_quantity: 0 });
    const refundProvider = createMockPaymentProvider();
    const refundRegistry = new ProviderRegistry("test", [refundProvider]);
    const refundKey = crypto.randomUUID();
    expect(
      await requestRefund(env.DB, refundRegistry, {
        paymentIntentId: intentId,
        amountMinor: 1,
        reason: "Partial financial remedy without returning goods",
        idempotencyKey: refundKey,
        actorId: manager.id,
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    if (!refundProvider.lookupRefund) throw new Error("Missing local refund lookup");
    const refundObservation = await refundProvider.lookupRefund({
      providerReference: `mock_pay_${intentId}`,
      providerRefundReference: null,
      refundProviderIdempotencyKey: refundKey,
    });
    if (refundObservation.outcome !== "FOUND") throw new Error("Missing local refund observation");
    setMockRefundObservation(refundProvider, refundKey, {
      outcome: "FOUND",
      refund: { ...refundObservation.refund, canonicalState: "SUCCEEDED", observedAt: Date.now() },
    });
    await reconcileRefunds(env.DB, refundRegistry, Date.now() + 120000);
    expect(await remaining()).toEqual({ remaining_quantity: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
      )
        .bind(committed.orderId)
        .first(),
    ).toEqual({ n: 2 });
    const cancellation = {
      orderId: committed.orderId,
      customerId,
      expectedVersion: 1,
      reason: "Cancel before preparation",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    await env.DB.exec(
      "CREATE TRIGGER suppress_sale_restore BEFORE UPDATE ON promotion_product_target WHEN NEW.remaining_quantity>OLD.remaining_quantity BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await requestOrderCancellation(env.DB, cancellation)).toMatchObject({ ok: false });
      expect(await remaining()).toEqual({ remaining_quantity: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
        )
          .bind(committed.orderId)
          .first(),
      ).toEqual({ n: 2 });
    } finally {
      await env.DB.exec("DROP TRIGGER suppress_sale_restore");
    }
    const canceled = await requestOrderCancellation(env.DB, cancellation);
    expect(canceled).toMatchObject({ ok: true });
    expect(await remaining()).toEqual({ remaining_quantity: 5 });
    expect(await requestOrderCancellation(env.DB, cancellation)).toEqual(canceled);
    expect(await remaining()).toEqual({ remaining_quantity: 5 });
    expect(
      await abandonCheckoutAttempt(env.DB, {
        ...second,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
      .bind(manager.id)
      .first<{ auth_user_id: string }>();
    if (!actor) throw new Error("Missing stock operator");
    const stock = () =>
      env.DB.prepare(
        "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
      )
        .bind(LOCATION)
        .first<{ on_hand: number; reserved: number; version: number }>();
    const before = (await stock())!;
    const reduction = {
      actorId: manager.id,
      actorAuthUserId: actor.auth_user_id,
      locationId: LOCATION,
      inventoryPoolId: "pool-red-onion",
      deltaBase: -(before.on_hand - before.reserved - 1000),
      expectedVersion: before.version,
      reason: "Remove unsellable onions",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    await env.DB.exec(
      "CREATE TRIGGER suppress_sale_cap BEFORE UPDATE ON promotion_product_target WHEN NEW.remaining_quantity<OLD.remaining_quantity BEGIN SELECT RAISE(IGNORE); END;",
    );
    try {
      expect(await adjustInventory(env.DB, reduction)).toMatchObject({ ok: false });
      expect(await stock()).toEqual(before);
      expect(await remaining()).toEqual({ remaining_quantity: 5 });
    } finally {
      await env.DB.exec("DROP TRIGGER suppress_sale_cap");
    }
    expect(await adjustInventory(env.DB, reduction)).toMatchObject({ ok: true });
    expect(await remaining()).toEqual({ remaining_quantity: 2 });
    expect(
      await adjustInventory(env.DB, {
        ...reduction,
        deltaBase: 5000,
        expectedVersion: (await stock())!.version,
        reason: "New stock",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await remaining()).toEqual({ remaining_quantity: 2 });
    const restartVersion = await env.DB.prepare("SELECT version FROM promotion WHERE id=?")
      .bind(saleId)
      .first<{ version: number }>();
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId: saleId,
        expectedVersion: restartVersion!.version,
        action: "ACTIVATE",
        reason: "Restart remaining two units",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const competing = await Promise.allSettled([
      seededInstantQuote(false, false, [], 2),
      seededInstantQuote(false, false, [], 2),
    ]);
    const completedQuotes = competing.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(completedQuotes.length).toBeGreaterThanOrEqual(1);
    const claims = await env.DB.prepare(
      "SELECT claim.checkout_quote_id quoteId FROM checkout_promotion_claim claim JOIN checkout_inventory_holds hold ON hold.checkout_attempt_id=claim.checkout_quote_id AND hold.status='HELD' WHERE claim.promotion_id=? AND claim.status='UNCOMMITTED'",
    )
      .bind(saleId)
      .all<{ quoteId: string }>();
    expect(claims.results).toHaveLength(1);
    const winner = completedQuotes.find((quote) => quote.quoteId === claims.results[0]?.quoteId);
    expect(winner).toBeDefined();
    for (const quote of completedQuotes)
      expect(
        await abandonCheckoutAttempt(env.DB, {
          ...quote,
          expectedVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
    expect(
      (await getProduct(env.DB, "red-onion", LOCATION))?.product.variants.find(
        (variant) => variant.id === "sku-red-onion-500g",
      )?.sale?.remainingQuantity,
    ).toBe(2);
  });
  it("cleans retained failed commitment work only after verified full refund", async () => {
    const f = await refundedUncommittedFixture();
    await env.DB.prepare("UPDATE payment_reaction SET status='FAILED' WHERE id=?")
      .bind(f.reactionId)
      .run();
    expect(await exports.default.resolveAdminReconciliationCase(f.command)).toMatchObject({
      ok: true,
      value: { resolutionAction: "CONFIRM_REFUNDED_COMMITMENT" },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
      )
        .bind(f.quoteId)
        .first(),
    ).toEqual({ n: 0 });
  });
  it("preserves checkout entitlements owned by another active payment for the same quote", async () => {
    const f = await refundedUncommittedFixture();
    const quote = await env.DB.prepare("SELECT total_minor FROM checkout_quote WHERE id=?")
      .bind(f.quoteId)
      .first<{ total_minor: number }>();
    if (!quote) throw new Error("Missing quote");
    const other = await createPayment(
      env.DB,
      new ProviderRegistry("test", [createMockPaymentProvider()]),
      {
        purpose: "GROCERY_CHECKOUT",
        subjectType: "checkout_quote",
        subjectId: f.quoteId,
        customerId: f.customerId,
        amountMinor: quote.total_minor,
        currency: "PHP",
        providerCode: "mock",
        returnUrl: "https://app.example/checkout",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      },
    );
    expect(other).toMatchObject({ ok: true });
    expect(await exports.default.resolveAdminReconciliationCase(f.command)).toMatchObject({
      ok: true,
    });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?").bind(f.quoteId).first(),
    ).toEqual({ status: "ACTIVE" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
      )
        .bind(f.quoteId)
        .first(),
    ).toEqual({ n: 2 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
      )
        .bind(f.intentId)
        .first(),
    ).toEqual({ n: 0 });
  });
  it.each(["none", "hold", "orderAudit", "paymentAudit", "reaction"] as const)(
    "closes a fully refunded uncommitted checkout with guarded %s cleanup",
    async (fault) => {
      const f = await refundedUncommittedFixture();
      const trigger =
        fault === "hold"
          ? "CREATE TRIGGER ignore_refunded_cleanup BEFORE UPDATE ON checkout_inventory_holds WHEN NEW.status='RELEASED' BEGIN SELECT RAISE(IGNORE); END"
          : fault === "reaction"
            ? "CREATE TRIGGER ignore_refunded_cleanup BEFORE UPDATE ON payment_reaction WHEN NEW.status='FAILED' BEGIN SELECT RAISE(IGNORE); END"
            : `CREATE TRIGGER ignore_refunded_cleanup BEFORE INSERT ON audit_event WHEN NEW.action='${fault === "orderAudit" ? "ORDER.REFUNDED_COMMITMENT_CLOSED" : "PAYMENT.REFUNDED_COMMITMENT_CONFIRMED"}' BEGIN SELECT RAISE(IGNORE); END`;
      if (fault !== "none") {
        await env.DB.exec(trigger);
        try {
          expect(await exports.default.resolveAdminReconciliationCase(f.command)).toMatchObject({
            ok: false,
            error: { code: "CONFLICT" },
          });
          expect(
            await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
              .bind(f.reactionId)
              .first(),
          ).toEqual({ status: "ESCALATED" });
          expect(
            await env.DB.prepare(
              "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='HELD'",
            )
              .bind(f.quoteId)
              .first(),
          ).toEqual({ n: 2 });
          expect(
            await env.DB.prepare(
              "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.payments.reconcile' AND idempotency_key=?",
            )
              .bind(f.command.idempotencyKey)
              .first(),
          ).toEqual({ n: 0 });
        } finally {
          await env.DB.exec("DROP TRIGGER ignore_refunded_cleanup");
        }
      }
      const accepted = await exports.default.resolveAdminReconciliationCase(f.command);
      expect(accepted).toMatchObject({
        ok: true,
        value: { status: "RESOLVED", resolutionAction: "CONFIRM_REFUNDED_COMMITMENT" },
      });
      expect(await exports.default.resolveAdminReconciliationCase(f.command)).toEqual(accepted);
      expect(
        await env.DB.prepare("SELECT status,last_error_code FROM payment_reaction WHERE id=?")
          .bind(f.reactionId)
          .first(),
      ).toEqual({ status: "FAILED", last_error_code: "REFUNDED_WITHOUT_COMMITMENT" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='RELEASED'",
        )
          .bind(f.quoteId)
          .first(),
      ).toEqual({ n: 2 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
        )
          .bind(f.intentId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM finance_exception WHERE payment_intent_id=? AND status='OPEN'",
        )
          .bind(f.intentId)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
  it("requires the entire captured amount to be refunded before completing the failed commitment", async () => {
    const f = await refundedUncommittedFixture(true);
    expect(await exports.default.resolveAdminReconciliationCase(f.command)).toMatchObject({
      ok: false,
    });
    await f.refund(1);
    expect(await exports.default.resolveAdminReconciliationCase(f.command)).toMatchObject({
      ok: true,
    });
  });
  it.each(["payment", "reaction", "refund"] as const)(
    "rejects a transaction-time %s change before all commitment effects",
    async (kind) => {
      await configureInstant();
      const { quoteId } = await seededInstantQuote(false, true);
      const { intentId, reactionId } = await seedReaction(quoteId);
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (kind === "payment")
                await target
                  .prepare(
                    "UPDATE payment_intent SET status='REFUNDED',version=version+1 WHERE id=?",
                  )
                  .bind(intentId)
                  .run();
              if (kind === "reaction")
                await target
                  .prepare("UPDATE payment_reaction SET subject_id='another-quote' WHERE id=?")
                  .bind(reactionId)
                  .run();
              if (kind === "refund")
                await target
                  .prepare(
                    "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,created_at,updated_at) VALUES (?, ?, 1, 'PHP','REQUESTED','Concurrent finance review',?,?,?)",
                  )
                  .bind(crypto.randomUUID(), intentId, crypto.randomUUID(), Date.now(), Date.now())
                  .run();
              return target.batch(statements);
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await applyCheckoutPaymentReaction(db, {
          reactionId,
          paymentIntentId: intentId,
          checkoutAttemptId: quoteId,
          canonicalPaymentState: "SUCCEEDED",
        }),
      ).toMatchObject({ applied: false });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM checkout_inventory_holds WHERE checkout_attempt_id=? AND status='COMMITTED'",
        )
          .bind(quoteId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
          .bind(reactionId)
          .first(),
      ).toEqual({ status: "PENDING" });
    },
  );
  it("recovers a failed paid commitment through reviewed Core retry and the same owning applier", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote(false, true);
    // Canonical captured payment is the existing explicit fixture seam.
    const { intentId, reactionId } = await seedReaction(quoteId);
    const now = Date.now();
    await env.DB.prepare("UPDATE payment_reaction SET attempts=4 WHERE id=?")
      .bind(reactionId)
      .run();
    await env.DB.exec(
      "CREATE TRIGGER fail_order_commit BEFORE INSERT ON grocery_order BEGIN SELECT RAISE(ABORT,'TEST_COMMIT_FAILURE'); END",
    );
    try {
      expect(
        await redrivePaymentReactions(env.DB, new ProviderRegistry("test", []), now),
      ).toMatchObject({ escalated: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_order_commit");
    }
    const record = await env.DB.prepare(
      "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
    )
      .bind(intentId)
      .first<{ id: string; version: number }>();
    if (!record) throw new Error("Missing exhausted commitment case");
    const manager = await locationManager("global");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='payments.manage'",
    )
      .bind(manager.id)
      .run();
    vi.setSystemTime(now + 16 * 60 * 1000);
    try {
      const command = {
        headers: manager.headers,
        caseId: record.id,
        expectedVersion: record.version,
        expectedPaymentVersion: 2,
        reason: "Local commitment persistence restored",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      };
      const accepted = await exports.default.retryAdminPaymentReaction(command);
      expect(accepted).toMatchObject({ ok: true, value: { state: "QUEUED" } });
      expect(
        await redrivePaymentReactions(env.DB, new ProviderRegistry("test", []), Date.now()),
      ).toMatchObject({ applied: 1 });
      expect(await exports.default.retryAdminPaymentReaction(command)).toEqual(accepted);
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ n: 1 });
      expect(
        await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
          .bind(reactionId)
          .first(),
      ).toEqual({ status: "SUCCEEDED" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM finance_exception WHERE payment_intent_id=? AND status='OPEN'",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE action='ORDER.COMMITMENT_RECOVERED' AND json_extract(details_json,'$.paymentIntentId')=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ n: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["audit", "projection"] as const)(
    "repairs a retained committed exception with required %s and no duplicate Order",
    async (fault) => {
      await configureInstant();
      const { quoteId } = await seededInstantQuote(false, true);
      const { intentId, reactionId } = await seedReaction(quoteId);
      const input = {
        reactionId,
        paymentIntentId: intentId,
        checkoutAttemptId: quoteId,
        canonicalPaymentState: "SUCCEEDED" as const,
      };
      const committed = await applyCheckoutPaymentReaction(env.DB, input);
      expect(committed.applied).toBe(true);
      // Explicit retained projection seam: an Order exists but its old exception was never closed.
      const manager = await locationManager("global");
      await env.DB.prepare(
        "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
      )
        .bind(manager.id)
        .run();
      const resolution = {
        headers: manager.headers,
        caseId: crypto.randomUUID(),
        expectedVersion: 1,
        reason: "Verified the committed Order after recovery",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      };
      await env.DB.prepare(
        "INSERT INTO payment_reconciliation_case(id,payment_intent_id,category,status,details_json,created_at,version) VALUES (?,?,'REACTION_FAILURE','OPEN',?, ?,1)",
      )
        .bind(resolution.caseId, intentId, JSON.stringify({ reactionId }), Date.now())
        .run();
      await env.DB.prepare(
        "INSERT INTO finance_exception(id,kind,payment_intent_id,reaction_id,details_json,attempts,status,created_at) VALUES (?,'TRANSIENT_FAILURE',?,?,'{}',1,'OPEN',?)",
      )
        .bind(crypto.randomUUID(), intentId, reactionId, Date.now())
        .run();
      await env.DB.exec(
        fault === "audit"
          ? "CREATE TRIGGER ignore_recovered_projection BEFORE INSERT ON audit_event WHEN NEW.action='ORDER.COMMITMENT_RECOVERED' BEGIN SELECT RAISE(IGNORE); END"
          : "CREATE TRIGGER ignore_recovered_projection BEFORE UPDATE ON finance_exception WHEN NEW.status='RESOLVED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        expect(await applyCheckoutPaymentReaction(env.DB, input)).toMatchObject({ applied: false });
        expect(await exports.default.resolveAdminReconciliationCase(resolution)).toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(
          await env.DB.prepare("SELECT status FROM payment_reconciliation_case WHERE id=?")
            .bind(resolution.caseId)
            .first(),
        ).toEqual({ status: "OPEN" });
        expect(
          await env.DB.prepare("SELECT status FROM finance_exception WHERE payment_intent_id=?")
            .bind(intentId)
            .first(),
        ).toEqual({ status: "OPEN" });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM audit_event WHERE action='ORDER.COMMITMENT_RECOVERED' AND aggregate_id=?",
          )
            .bind(committed.orderId)
            .first(),
        ).toEqual({ n: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_recovered_projection");
      }
      const resolved = await exports.default.resolveAdminReconciliationCase(resolution);
      expect(resolved).toMatchObject({ ok: true });
      expect(await exports.default.resolveAdminReconciliationCase(resolution)).toEqual(resolved);
      expect(await applyCheckoutPaymentReaction(env.DB, input)).toMatchObject({ applied: true });
      expect(
        await env.DB.prepare(
          "SELECT status,order_id FROM finance_exception WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ status: "RESOLVED", order_id: committed.orderId });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE action='ORDER.COMMITMENT_RECOVERED' AND aggregate_id=?",
        )
          .bind(committed.orderId)
          .first(),
      ).toEqual({ n: 1 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM order_payment_reaction WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ n: 1 });
    },
  );
  it("allows only one winner between customer cancellation and preparation", async () => {
    await configureInstant();
    const { quoteId, customerId } = await seededInstantQuote(false);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const committed = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    if (!committed.applied || !committed.orderId) throw new Error("Order did not commit");
    const orderId = committed.orderId;
    const cancellationKey = crypto.randomUUID();
    const preparationKey = crypto.randomUUID();
    const [canceled, prepared] = await Promise.all([
      requestOrderCancellation(env.DB, {
        orderId,
        customerId,
        expectedVersion: 1,
        reason: "Cancel before preparation",
        idempotencyKey: cancellationKey,
        requestId: crypto.randomUUID(),
      }),
      advanceFulfillment(
        env.DB,
        {
          orderId,
          headers: {},
          action: "START_PICKING",
          expectedVersion: 1,
          idempotencyKey: preparationKey,
          requestId: crypto.randomUUID(),
        },
        { authorize: async () => true },
      ),
    ]);
    expect([canceled, prepared].filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?) AND status='SUCCEEDED'",
      )
        .bind(cancellationKey, preparationKey)
        .first(),
    ).toEqual({ count: 1 });
    if (prepared.ok) {
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
      ).toEqual({ status: "FULFILLMENT_PENDING" });
      expect(
        await env.DB.prepare("SELECT status FROM inventory_reservation WHERE order_id=?")
          .bind(orderId)
          .first(),
      ).toEqual({ status: "RESERVED" });
      expect(
        await env.DB.prepare("SELECT id FROM order_cancellation WHERE order_id=?")
          .bind(orderId)
          .first(),
      ).toBeNull();
    } else {
      expect(
        await env.DB.prepare("SELECT status FROM inventory_reservation WHERE order_id=?")
          .bind(orderId)
          .first(),
      ).toEqual({ status: "RELEASED" });
      expect(
        await env.DB.prepare(
          "SELECT id FROM fulfillment_record WHERE order_id=? AND status='PICKING'",
        )
          .bind(orderId)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM inventory_ledger_entries WHERE reference_id=? AND reason_code='ORDER_CANCELLATION'",
        )
          .bind(orderId)
          .first(),
      ).toEqual({ count: 1 });
    }
  });

  it("rejects packing an incomplete reservation set without consuming either pool", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote(false, true);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const committed = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    if (!committed.applied || !committed.orderId) throw new Error("Order did not commit");
    const orderId = committed.orderId;
    for (const [index, action] of (
      ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
    ).entries()) {
      expect(
        await advanceFulfillment(
          env.DB,
          {
            orderId,
            headers: {},
            action,
            expectedVersion: index + 1,
            idempotencyKey: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
          },
          { authorize: async () => true },
        ),
      ).toMatchObject({ ok: true });
    }
    await env.DB.prepare(
      "UPDATE inventory_reservation SET status='RELEASED' WHERE order_id=? AND inventory_pool_id='pool-red-onion'",
    )
      .bind(orderId)
      .run();
    const before = await env.DB.prepare(
      "SELECT inventory_pool_id,on_hand,reserved,version FROM inventory_balance WHERE location_id=? ORDER BY inventory_pool_id",
    )
      .bind(LOCATION)
      .all();
    const key = crypto.randomUUID();
    expect(
      await advanceFulfillment(
        env.DB,
        {
          orderId,
          headers: {},
          action: "MARK_PACKED",
          expectedVersion: 4,
          idempotencyKey: key,
          requestId: crypto.randomUUID(),
        },
        { authorize: async () => true },
      ),
    ).toMatchObject({ ok: false });
    expect(
      (
        await env.DB.prepare(
          "SELECT inventory_pool_id,on_hand,reserved,version FROM inventory_balance WHERE location_id=? ORDER BY inventory_pool_id",
        )
          .bind(LOCATION)
          .all()
      ).results,
    ).toEqual(before.results);
    expect(
      await env.DB.prepare("SELECT status,version FROM fulfillment_record WHERE order_id=?")
        .bind(orderId)
        .first(),
    ).toEqual({ status: "PACKING", version: 4 });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "FULFILLMENT_PENDING" });
    expect(
      await env.DB.prepare(
        "SELECT id FROM inventory_ledger_entries WHERE reference_id=? AND reason_code='ORDER_PACKED'",
      )
        .bind(orderId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT idempotency_key FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
      )
        .bind(key)
        .first(),
    ).toBeNull();
  });

  it("serializes paid Instant acceptance against customer cancellation", async () => {
    await configureInstant();
    const { quoteId, customerId } = await seededInstantQuote(false, true);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const committed = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    if (!committed.applied || !committed.orderId) throw new Error("Order did not commit");
    const orderId = committed.orderId;
    const accept = {
      orderId,
      requestId: crypto.randomUUID(),
      headers: {},
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      action: "START_PICKING" as const,
    };
    const cancel = {
      orderId,
      customerId,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      reason: "Customer changed plans",
    };
    const outcomes = await Promise.all([
      advanceFulfillment(env.DB, accept, { authorize: async () => true }),
      requestOrderCancellation(env.DB, cancel),
    ]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    const accepted = outcomes[0].ok;
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: accepted ? "FULFILLMENT_PENDING" : "CANCELLATION_REQUESTED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM order_cancellation WHERE order_id=?")
        .bind(orderId)
        .first(),
    ).toEqual({ count: accepted ? 0 : 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
      )
        .bind(orderId)
        .first(),
    ).toEqual({ count: accepted ? 2 : 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?) AND status='SUCCEEDED'",
      )
        .bind(accept.idempotencyKey, cancel.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    if (accepted)
      expect(await advanceFulfillment(env.DB, accept, { authorize: async () => true })).toEqual(
        outcomes[0],
      );
    else expect(await requestOrderCancellation(env.DB, cancel)).toEqual(outcomes[1]);
  });

  it("reaches packing through preparation, locks cancellation, and consumes both pools exactly once", async () => {
    await configureInstant();
    const { quoteId, customerId } = await seededInstantQuote(false, true);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const committed = await applyCheckoutPaymentReaction(env.DB, {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    if (!committed.applied || !committed.orderId) throw new Error("Order did not commit");
    const orderId = committed.orderId;
    const request = {
      orderId,
      requestId: crypto.randomUUID(),
      headers: {},
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      action: "START_PICKING" as const,
    };
    expect(
      await advanceFulfillment(env.DB, request, { authorize: async () => false }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await advanceFulfillment(env.DB, request, { authorize: async () => true }),
    ).toMatchObject({ ok: true, value: { status: "PICKING" } });
    expect(
      await requestOrderCancellation(env.DB, {
        orderId,
        customerId,
        expectedVersion: 2,
        reason: "Too late",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await advanceFulfillment(
        env.DB,
        { ...request, action: "HAND_OFF", expectedVersion: 2, idempotencyKey: crypto.randomUUID() },
        { authorize: async () => true },
      ),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    for (const [index, action] of (
      ["MARK_READY_TO_PACK", "START_PACKING", "MARK_PACKED"] as const
    ).entries()) {
      const step = {
        ...request,
        action,
        expectedVersion: index + 2,
        idempotencyKey: crypto.randomUUID(),
      };
      if (action === "MARK_PACKED") {
        const competitor = { ...step, idempotencyKey: crypto.randomUUID() };
        const results = await Promise.all([
          advanceFulfillment(env.DB, step, { authorize: async () => true }),
          advanceFulfillment(env.DB, competitor, { authorize: async () => true }),
        ]);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        const winner = results[0].ok ? step : competitor;
        expect(
          await advanceFulfillment(env.DB, winner, { authorize: async () => true }),
        ).toMatchObject({ ok: true });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?) AND status='SUCCEEDED'",
          )
            .bind(step.idempotencyKey, competitor.idempotencyKey)
            .first(),
        ).toEqual({ count: 1 });
      } else {
        expect((await advanceFulfillment(env.DB, step, { authorize: async () => true })).ok).toBe(
          true,
        );
        expect((await advanceFulfillment(env.DB, step, { authorize: async () => true })).ok).toBe(
          true,
        );
      }
    }
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "FULFILLMENT_READY" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count,SUM(quantity_delta_base) consumed,SUM(reservation_delta_base) released FROM inventory_ledger_entries WHERE reference_id=? AND reason_code='ORDER_PACKED'",
      )
        .bind(orderId)
        .first(),
    ).toEqual({ count: 2, consumed: -3500, released: -3500 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_reservation WHERE order_id=? AND status='CONSUMED'",
      )
        .bind(orderId)
        .first(),
    ).toEqual({ count: 2 });
  });

  it("protects checkout-held stock from manual removal", async () => {
    await configureInstant();
    await seededInstantQuote(false);
    const before = await env.DB.prepare(
      "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
    )
      .bind(LOCATION)
      .first<{ on_hand: number; reserved: number; version: number }>();
    if (!before) throw new Error("Inventory fixture missing");
    const manager = await locationManager("location");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='inventory.read'",
    )
      .bind(manager.id)
      .run();
    const held = await env.DB.prepare(
      "SELECT SUM(quantity) quantity FROM checkout_inventory_holds WHERE location_id=? AND inventory_pool_id='pool-red-onion' AND status='HELD'",
    )
      .bind(LOCATION)
      .first<{ quantity: number }>();
    expect(held?.quantity).toBeGreaterThan(0);
    let cursor: string | undefined;
    let observed = false;
    do {
      const page = await exports.default.listAdminInventory({
        headers: manager.headers,
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        limit: 100,
        cursor,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) throw new Error("Inventory read rejected");
      const item = page.value.items.find((row) => row.inventoryPoolId === "pool-red-onion");
      if (item) {
        expect(item).toMatchObject({
          heldBase: held?.quantity,
          availableBase: before.on_hand - before.reserved - (held?.quantity ?? 0),
        });
        observed = true;
        break;
      }
      cursor = page.value.nextCursor ?? undefined;
    } while (cursor);
    expect(observed).toBe(true);
    const key = crypto.randomUUID();
    const result = await adjustInventory(env.DB, {
      locationId: LOCATION,
      inventoryPoolId: "pool-red-onion",
      deltaBase: -(before.on_hand - before.reserved - 2000),
      expectedVersion: before.version,
      idempotencyKey: key,
      actorId: "staff-adjustment",
      reason: "Remove stock while held",
      requestId: crypto.randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
    expect(
      await env.DB.prepare(
        "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
      )
        .bind(LOCATION)
        .first(),
    ).toEqual(before);
    expect(
      await env.DB.prepare("SELECT id FROM inventory_ledger_entries WHERE idempotency_key=?")
        .bind(key)
        .first(),
    ).toBeNull();
  });

  it("commits an already-started payment after quote expiry and selling pause", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote(false);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const expiredAt = Date.now() - 100;
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_intent SET created_at=? WHERE id=?").bind(
        expiredAt - 1000,
        intentId,
      ),
      env.DB.prepare("UPDATE checkout_quote SET status='EXPIRED',expires_at=? WHERE id=?").bind(
        expiredAt,
        quoteId,
      ),
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='PAUSED' WHERE id='global'",
      ),
    ]);
    expect(
      await applyCheckoutPaymentReaction(env.DB, {
        reactionId,
        paymentIntentId: intentId,
        checkoutAttemptId: quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ).toMatchObject({ applied: true });
  });

  it("commits two pools with distinct ledger effects and replays without duplicate reservations", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote(false, true);
    const { reactionId, intentId } = await seedReaction(quoteId);
    const input = {
      reactionId,
      paymentIntentId: intentId,
      checkoutAttemptId: quoteId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    const result = await applyCheckoutPaymentReaction(env.DB, input);
    expect(result).toMatchObject({ applied: true, reason: "APPLIED" });
    expect(await applyCheckoutPaymentReaction(env.DB, input)).toMatchObject({
      applied: true,
      reason: "ALREADY_APPLIED",
      orderId: result.orderId,
    });
    const ledger = await env.DB.prepare(
      "SELECT COUNT(*) count, COUNT(DISTINCT idempotency_key) identities, SUM(reservation_delta_base) reserved FROM inventory_ledger_entries WHERE reference_id=? AND reason_code='CHECKOUT_COMMIT'",
    )
      .bind(result.orderId ?? "missing")
      .first();
    expect(ledger).toEqual({ count: 2, identities: 2, reserved: 3500 });
  });

  it.each(["missing", "released", "wrong quantity", "wrong location"])(
    "preserves successful payment but refuses a %s hold without partial commitment",
    async (defect) => {
      await configureInstant();
      const { quoteId } = await seededInstantQuote(false);
      const { reactionId, intentId } = await seedReaction(quoteId);
      if (defect === "missing") {
        await env.DB.prepare("DELETE FROM checkout_inventory_holds WHERE checkout_attempt_id=?")
          .bind(quoteId)
          .run();
      } else if (defect === "released") {
        await env.DB.prepare(
          "UPDATE checkout_inventory_holds SET status='RELEASED' WHERE checkout_attempt_id=?",
        )
          .bind(quoteId)
          .run();
      } else if (defect === "wrong quantity") {
        await env.DB.prepare(
          "UPDATE checkout_inventory_holds SET quantity=1 WHERE checkout_attempt_id=?",
        )
          .bind(quoteId)
          .run();
      } else {
        await env.DB.prepare(
          "INSERT INTO fulfillment_location (id,market_id,code,name,type,status,latitude,longitude,created_at,updated_at) SELECT 'wrong-hold-location',market_id,'WRONG_HOLD','Wrong hold','FULFILLMENT_CENTER','active',latitude,longitude,0,0 FROM fulfillment_location WHERE id=? ON CONFLICT(id) DO NOTHING",
        )
          .bind(LOCATION)
          .run();
        await env.DB.prepare(
          "UPDATE checkout_inventory_holds SET location_id='wrong-hold-location' WHERE checkout_attempt_id=?",
        )
          .bind(quoteId)
          .run();
      }
      const before = await env.DB.prepare(
        "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
      )
        .bind(LOCATION)
        .first();
      expect(
        await applyCheckoutPaymentReaction(env.DB, {
          reactionId,
          paymentIntentId: intentId,
          checkoutAttemptId: quoteId,
          canonicalPaymentState: "SUCCEEDED",
        }),
      ).toMatchObject({ applied: false });
      expect(
        await env.DB.prepare(
          "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id='pool-red-onion'",
        )
          .bind(LOCATION)
          .first(),
      ).toEqual(before);
      expect(
        await env.DB.prepare(
          "SELECT order_id FROM order_payment_reaction WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(intentId).first(),
      ).toEqual({ status: "SUCCEEDED" });
      expect(
        await env.DB.prepare("SELECT status FROM finance_exception WHERE payment_intent_id=?")
          .bind(intentId)
          .first(),
      ).toEqual({ status: "OPEN" });
    },
  );

  it("commits a no-cycle order with promise snapshot, converted holds, and reservation", async () => {
    await configureInstant();
    const { quoteId } = await seededInstantQuote(false);
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
      `SELECT cycle_id, fulfillment_mode, pre_service_fee_total_minor,
              service_fee_minor, service_fee_configuration_id,
              service_fee_snapshot_json
       FROM grocery_order WHERE id=?`,
    )
      .bind(orderId)
      .first<{
        cycle_id: string | null;
        fulfillment_mode: string;
        pre_service_fee_total_minor: number;
        service_fee_minor: number;
        service_fee_configuration_id: string | null;
        service_fee_snapshot_json: string | null;
      }>();
    expect(order).toMatchObject({
      cycle_id: null,
      fulfillment_mode: "INSTANT",
      service_fee_configuration_id: null,
    });
    expect(order?.service_fee_minor).toBe(0);
    expect(order?.service_fee_snapshot_json).toBeNull();
    const snapshot = await env.DB.prepare(
      "SELECT promised_at, cycle_id, delivery_execution_snapshot_json FROM order_fulfillment_snapshot WHERE order_id=?",
    )
      .bind(orderId)
      .first<{
        promised_at: number | null;
        cycle_id: string | null;
        delivery_execution_snapshot_json: string | null;
      }>();
    expect(snapshot?.cycle_id).toBeNull();
    expect(snapshot?.promised_at).toBeGreaterThan(Date.now());
    expect(JSON.parse(snapshot!.delivery_execution_snapshot_json!)).toEqual({
      selectedBy: "CUSTOMER",
      method: "EXTERNAL_PROVIDER",
      providerCode: "lalamove",
      providerServiceType: "MOTORCYCLE",
      providerDisplayName: "Lalamove",
    });
    const job = await env.DB.prepare(
      "SELECT fulfillment_mode, cycle_id, location_id, zone_id, promised_at, status, rider_user_id FROM delivery_job WHERE order_id=?",
    )
      .bind(orderId)
      .first<{
        fulfillment_mode: string;
        cycle_id: string | null;
        location_id: string | null;
        zone_id: string | null;
        promised_at: number | null;
        status: string;
        rider_user_id: string | null;
      }>();
    expect(job).toMatchObject({
      fulfillment_mode: "INSTANT",
      cycle_id: null,
      location_id: LOCATION,
      zone_id: "zone-cebu-city-core",
      status: "UNASSIGNED",
      rider_user_id: null,
    });
    expect(Number(job?.promised_at)).toBeGreaterThan(Date.now());
    const stop = await env.DB.prepare(
      "SELECT ds.batch_id, ds.sequence, ds.latitude, ds.longitude, ds.address_snapshot_json, ds.contact_snapshot_json, ds.instructions_snapshot, ds.status FROM delivery_stop ds JOIN delivery_job dj ON dj.id=ds.delivery_job_id WHERE dj.order_id=?",
    )
      .bind(orderId)
      .first<Record<string, unknown>>();
    expect(stop).toMatchObject({
      batch_id: null,
      sequence: null,
      latitude: 10.32,
      longitude: 123.9,
      contact_snapshot_json: '{"recipient":"C","phone":"+639171234567"}',
      instructions_snapshot: '{"deliveryNote":"Call on arrival"}',
      status: "UNASSIGNED",
    });
    expect(JSON.parse(String(stop?.address_snapshot_json))).toMatchObject({
      recipient: "C",
      phone: "+639171234567",
      latitude: 10.32,
      longitude: 123.9,
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

  it("commits both paid orders beyond a retired order-count setting", async () => {
    // Retained capacity values have no authority over confirmed payments.
    const prior = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM grocery_order go
       JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id=go.id
       WHERE snapshot.location_id=? AND snapshot.fulfillment_mode='INSTANT'
         AND go.status NOT IN ('CANCELED','REFUNDED','DELIVERED')`,
    )
      .bind(LOCATION)
      .first<{ count: number }>();
    const initialCount = prior?.count ?? 0;
    await configureInstant(initialCount + 1);
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
    const secondInput = {
      reactionId: secondReaction.reactionId,
      paymentIntentId: secondReaction.intentId,
      checkoutAttemptId: second.quoteId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    const committed = await applyCheckoutPaymentReaction(env.DB, secondInput);
    expect(committed).toMatchObject({ applied: true, reason: "APPLIED" });
    const orders = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_payment_reaction WHERE payment_intent_id IN (?,?)",
    )
      .bind(firstReaction.intentId, secondReaction.intentId)
      .first<{ count: number }>();
    expect(orders?.count).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM inventory_reservation WHERE order_id IN (?,?)",
      )
        .bind(ok.orderId, committed.orderId)
        .first(),
    ).toEqual({ count: 2 });
    expect(await applyCheckoutPaymentReaction(env.DB, secondInput)).toMatchObject({
      applied: true,
      orderId: committed.orderId,
    });
    await configureInstant(25);
  });
});
