import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { hasUnresolvedScheduledCommitment } from "../../payments/infrastructure/d1/scheduled-commitment-readiness";
import { requestRefund } from "../../payments/application/request-refund";
import { reconcileRefunds } from "../../payments/application/reconcile-refunds";
import { redrivePaymentReactions } from "../../payments/application/redrive-payment-reactions";
import { createOrderAmendment } from "./create-order-amendment";
import { listOrderAdditionOptions } from "./list-order-addition-options";
import { applyAmendmentPaymentReaction } from "./apply-amendment-payment-reaction";
import { createAmendmentPaymentIntent } from "../../payments/application/create-amendment-payment-intent";
import { reconcilePayment } from "../../payments/application/reconcile-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
  setMockRefundObservation,
} from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { resolveOrderDeliveryPackage } from "../../fulfillment/application/resolve-order-delivery-package";

let counter = 0;
async function committedOrder(cycleIdOverride?: string) {
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
    "INSERT INTO inventory_pool (id, base_unit_id, sourcing_mode, created_at, updated_at) VALUES (?, 'unit-gram', 'STOCKED', 1, 1)",
  )
    .bind(poolId)
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
    "INSERT INTO sku_location_availability (sku_id, location_id, availability_status, sourcing_mode, version) VALUES (?, 'location-cebu-central', 'AVAILABLE', 'PLANNED', 1)",
  )
    .bind(skuId)
    .run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES ('location-cebu-central', ?, 50000, 0, 1)",
  )
    .bind(poolId)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO price_version (id, sku_id, market_id, location_id, currency, amount_minor, price_type, valid_from, version, created_at) VALUES (?, ?, 'market-metro-cebu', 'location-cebu-central', 'PHP', 8000, 'STANDARD', 0, 1, 1)",
  )
    .bind(crypto.randomUUID(), skuId)
    .run();

  // Committed order skeleton with snapshot and one reaction link.
  const orderId = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  const reactionId = crypto.randomUUID();
  const cycleId =
    cycleIdOverride ??
    (await env.DB.prepare("SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1").first<{
      id: string;
    }>())!.id;
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
    "INSERT INTO order_item (id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,?,'Amd Product','Amd 500g','gram',2,8000,16000,1000,'GRAM',1000)",
  )
    .bind(crypto.randomUUID(), orderId, skuId)
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
  it("offers named exact-location additions without checking physical stock, and hides unowned Orders", async () => {
    const order = await committedOrder();
    await env.DB.prepare(
      "UPDATE inventory_balance SET on_hand=0 WHERE inventory_pool_id=(SELECT p.inventory_pool_id FROM product p JOIN sku s ON s.product_id=p.id WHERE s.id=?)",
    )
      .bind(order.skuId)
      .run();
    const input = { ...order, query: "Amd Product", requestId: crypto.randomUUID() };
    expect(await listOrderAdditionOptions(env.DB, input)).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            skuId: order.skuId,
            productName: "Amd Product",
            variantName: "Amd 500g",
            priceMinor: 8000,
            currency: "PHP",
          },
        ],
        hasMore: false,
      },
    });
    expect(
      await listOrderAdditionOptions(env.DB, { ...input, customerId: "another-customer" }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await env.DB.prepare(
      "UPDATE sku_location_availability SET availability_status='UNAVAILABLE' WHERE sku_id=? AND location_id='location-cebu-central'",
    )
      .bind(order.skuId)
      .run();
    expect(await listOrderAdditionOptions(env.DB, input)).toMatchObject({
      ok: true,
      value: { items: [] },
    });
  });
  it("bounds addition search and excludes expired exact-location prices", async () => {
    const order = await committedOrder();
    const input = { ...order, query: "Amd Product", requestId: crypto.randomUUID() };
    await env.DB.prepare(
      "UPDATE price_version SET valid_to=? WHERE sku_id=? AND location_id='location-cebu-central'",
    )
      .bind(Date.now() - 1, order.skuId)
      .run();
    expect(await listOrderAdditionOptions(env.DB, input)).toMatchObject({
      ok: true,
      value: { items: [] },
    });
    const all = await listOrderAdditionOptions(env.DB, { ...input, query: "" });
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.value.items.length).toBeLessThanOrEqual(25);
      expect(all.value.hasMore).toBe(true);
    }
    expect(
      await listOrderAdditionOptions(env.DB, { ...input, query: "' OR 1=1 --" }),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });
  it.each(["cutoff", "cancellation", "version", "missing-link"] as const)(
    "rejects %s at payment admission without an intent or provider submission",
    async (kind) => {
      const cycleId = crypto.randomUUID();
      await seedTestCycle(env.DB, cycleId);
      const f = await committedOrder(cycleId);
      const addition = await createOrderAmendment(env.DB, {
        customerId: f.customerId,
        orderId: f.orderId,
        expectedOrderVersion: 5,
        additions: [{ skuId: f.skuId, quantity: 2 }],
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      });
      if (!addition.ok) throw new Error(addition.error.message);
      const provider = createMockPaymentProvider();
      let submissions = 0,
        reached = false;
      const registry = new ProviderRegistry("test", [
        {
          ...provider,
          createPayment: async (...args: Parameters<typeof provider.createPayment>) => {
            submissions++;
            return provider.createPayment(...args);
          },
        },
      ]);
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "cutoff")
                await target
                  .prepare(
                    "UPDATE delivery_cycle SET cutoff_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=?",
                  )
                  .bind(cycleId)
                  .run();
              if (kind === "cancellation")
                await target
                  .prepare("UPDATE grocery_order SET status='CANCELLATION_REQUESTED' WHERE id=?")
                  .bind(f.orderId)
                  .run();
              if (kind === "version")
                await target
                  .prepare("UPDATE paid_order_amendment SET version=version+1 WHERE id=?")
                  .bind(addition.value.amendmentId)
                  .run();
              if (kind === "missing-link")
                await target
                  .prepare(
                    "CREATE TRIGGER ignore_addition_payment_link BEFORE UPDATE OF payment_intent_id ON paid_order_amendment BEGIN SELECT RAISE(IGNORE); END",
                  )
                  .run();
              try {
                return await target.batch(statements);
              } finally {
                if (kind === "missing-link")
                  await target.prepare("DROP TRIGGER ignore_addition_payment_link").run();
              }
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const idempotencyKey = crypto.randomUUID();
      expect(
        await createAmendmentPaymentIntent(db, registry, "mock", {
          customerId: f.customerId,
          amendmentId: addition.value.amendmentId,
          expectedAmendmentVersion: addition.value.version,
          expectedCurrency: "PHP",
          expectedTotalMinor: addition.value.financial.totalMinor,
          returnUrl: "https://app.example/orders",
          idempotencyKey,
          requestId: crypto.randomUUID(),
          headers: {},
        }),
      ).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      expect(submissions).toBe(0);
      expect(
        await env.DB.prepare("SELECT id FROM payment_intent WHERE idempotency_key=?")
          .bind(idempotencyKey)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT payment_intent_id FROM paid_order_amendment WHERE id=?")
          .bind(addition.value.amendmentId)
          .first(),
      ).toEqual({ payment_intent_id: null });
    },
  );
  it("commits an already-started addition after cycle cutoff exactly once and clears purchase blocking", async () => {
    const cycleId = crypto.randomUUID();
    await seedTestCycle(env.DB, cycleId);
    const f = await committedOrder(cycleId);
    const addition = await createOrderAmendment(env.DB, {
      customerId: f.customerId,
      orderId: f.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: f.skuId, quantity: 2 }],
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });
    if (!addition.ok) throw new Error(addition.error.message);
    const provider = createMockPaymentProvider(),
      registry = new ProviderRegistry("test", [provider]);
    const command = {
      customerId: f.customerId,
      amendmentId: addition.value.amendmentId,
      expectedAmendmentVersion: addition.value.version,
      expectedCurrency: "PHP",
      expectedTotalMinor: addition.value.financial.totalMinor,
      returnUrl: "https://app.example/orders",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      headers: {},
    };
    const payment = await createAmendmentPaymentIntent(env.DB, registry, "mock", command);
    if (!payment.ok) throw new Error(payment.error.message);
    await env.DB.prepare("UPDATE delivery_cycle SET status='CUTOFF_REACHED',cutoff_at=? WHERE id=?")
      .bind(Date.now() - 1, cycleId)
      .run();
    expect(await hasUnresolvedScheduledCommitment(env.DB, cycleId)).toBe(true);
    expect(await createAmendmentPaymentIntent(env.DB, registry, "mock", command)).toEqual(payment);
    const lateKey = crypto.randomUUID();
    expect(
      await createAmendmentPaymentIntent(env.DB, registry, "mock", {
        ...command,
        idempotencyKey: lateKey,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT id FROM payment_intent WHERE idempotency_key=?")
        .bind(lateKey)
        .first(),
    ).toBeNull();
    const attempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ provider_reference: string }>();
    if (!attempt) throw new Error("Missing attempt");
    setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
    await reconcilePayment(env.DB, registry, {
      paymentIntentId: payment.value.paymentIntentId,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: crypto.randomUUID(),
    });
    const reaction = await env.DB.prepare(
      "SELECT id FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ id: string }>();
    if (!reaction) throw new Error("Missing reaction");
    const reactionCommand = {
      reactionId: reaction.id,
      paymentIntentId: payment.value.paymentIntentId,
      amendmentId: addition.value.amendmentId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    expect(await applyAmendmentPaymentReaction(env.DB, reactionCommand)).toMatchObject({
      applied: true,
    });
    expect(await applyAmendmentPaymentReaction(env.DB, reactionCommand)).toEqual({
      applied: true,
      reason: "ALREADY_APPLIED",
    });
    expect(await hasUnresolvedScheduledCommitment(env.DB, cycleId)).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n,SUM(quantity_base_total) grams FROM committed_demand WHERE delivery_cycle_id=?",
      )
        .bind(cycleId)
        .first(),
    ).toEqual({ n: 1, grams: 1000 });
  });
  it("closes a fully refunded uncommitted addition without changing the original Order or demand", async () => {
    const f = await committedOrder();
    const addition = await createOrderAmendment(env.DB, {
      customerId: f.customerId,
      orderId: f.orderId,
      expectedOrderVersion: 5,
      additions: [{ skuId: f.skuId, quantity: 2 }],
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });
    if (!addition.ok) throw new Error("Missing addition");
    const provider = createMockPaymentProvider(),
      registry = new ProviderRegistry("test", [provider]);
    const payment = await createAmendmentPaymentIntent(env.DB, registry, "mock", {
      customerId: f.customerId,
      amendmentId: addition.value.amendmentId,
      expectedAmendmentVersion: addition.value.version,
      expectedCurrency: "PHP",
      expectedTotalMinor: addition.value.financial.totalMinor,
      returnUrl: "https://app.example/orders",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      headers: {},
    });
    if (!payment.ok) throw new Error("Missing payment");
    const paymentId = payment.value.paymentIntentId;
    const attempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(paymentId)
      .first<{ provider_reference: string }>();
    if (!attempt) throw new Error("Missing attempt");
    setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
    await reconcilePayment(env.DB, registry, {
      paymentIntentId: paymentId,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: crypto.randomUUID(),
    });
    const reaction = await env.DB.prepare(
      "SELECT id FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(paymentId)
      .first<{ id: string }>();
    if (!reaction) throw new Error("Missing reaction");
    // Retained exhausted-attempt seam; the scheduler creates the actual review case.
    await env.DB.prepare("UPDATE payment_reaction SET attempts=5,available_at=0 WHERE id=?")
      .bind(reaction.id)
      .run();
    await redrivePaymentReactions(env.DB, registry, Date.now());
    const refundKey = crypto.randomUUID();
    expect(
      await requestRefund(env.DB, registry, {
        paymentIntentId: paymentId,
        amountMinor: addition.value.financial.totalMinor,
        reason: "Addition could not be committed",
        idempotencyKey: refundKey,
        actorId: "finance-test",
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    if (!provider.lookupRefund) throw new Error("Missing provider lookup");
    const observation = await provider.lookupRefund({
      providerReference: attempt.provider_reference,
      providerRefundReference: null,
      refundProviderIdempotencyKey: refundKey,
    });
    if (observation.outcome !== "FOUND") throw new Error("Missing provider refund acceptance");
    setMockRefundObservation(provider, refundKey, {
      outcome: "FOUND",
      refund: { ...observation.refund, canonicalState: "SUCCEEDED", observedAt: Date.now() },
    });
    await reconcileRefunds(env.DB, registry, Date.now() + 120000);
    const record = await env.DB.prepare(
      "SELECT id,version FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
    )
      .bind(paymentId)
      .first<{ id: string; version: number }>();
    if (!record) throw new Error("Missing case");
    const manager = await locationManager("global");
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
    )
      .bind(manager.id)
      .run();
    expect(
      await exports.default.resolveAdminReconciliationCase({
        headers: manager.headers,
        caseId: record.id,
        expectedVersion: record.version,
        reason: "Confirmed the full addition refund",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { resolutionAction: "CONFIRM_REFUNDED_COMMITMENT" } });
    expect(
      await env.DB.prepare("SELECT status,total_minor FROM grocery_order WHERE id=?")
        .bind(f.orderId)
        .first(),
    ).toEqual({ status: "COMMITTED", total_minor: 16000 });
    expect(
      await env.DB.prepare("SELECT status FROM paid_order_amendment WHERE id=?")
        .bind(addition.value.amendmentId)
        .first(),
    ).toEqual({ status: "FAILED" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM committed_demand WHERE amendment_line_id IN (SELECT id FROM paid_order_amendment_line WHERE amendment_id=?)",
      )
        .bind(addition.value.amendmentId)
        .first(),
    ).toEqual({ n: 0 });
  });
  it.each(["paymentVersion", "refund"] as const)(
    "rejects a transaction-time %s change without committing paid additions",
    async (kind) => {
      const f = await committedOrder();
      const addition = await createOrderAmendment(env.DB, {
        customerId: f.customerId,
        orderId: f.orderId,
        expectedOrderVersion: 5,
        additions: [{ skuId: f.skuId, quantity: 2 }],
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      });
      if (!addition.ok) throw new Error("Missing addition");
      const provider = createMockPaymentProvider(),
        registry = new ProviderRegistry("test", [provider]);
      const payment = await createAmendmentPaymentIntent(env.DB, registry, "mock", {
        customerId: f.customerId,
        amendmentId: addition.value.amendmentId,
        expectedAmendmentVersion: addition.value.version,
        expectedCurrency: "PHP",
        expectedTotalMinor: addition.value.financial.totalMinor,
        returnUrl: "https://app.example/orders",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        headers: {},
      });
      if (!payment.ok) throw new Error("Missing payment");
      const paymentId = payment.value.paymentIntentId;
      const attempt = await env.DB.prepare(
        "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
      )
        .bind(paymentId)
        .first<{ provider_reference: string }>();
      if (!attempt) throw new Error("Missing attempt");
      setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
      await reconcilePayment(env.DB, registry, {
        paymentIntentId: paymentId,
        idempotencyKey: crypto.randomUUID(),
        actorId: "test",
        requestId: crypto.randomUUID(),
      });
      const reaction = await env.DB.prepare(
        "SELECT id FROM payment_reaction WHERE payment_intent_id=?",
      )
        .bind(paymentId)
        .first<{ id: string }>();
      if (!reaction) throw new Error("Missing reaction");
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (kind === "paymentVersion")
                await target
                  .prepare("UPDATE payment_intent SET version=version+1 WHERE id=?")
                  .bind(paymentId)
                  .run();
              else
                await target
                  .prepare(
                    "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,created_at,updated_at) VALUES (?,?,1,'PHP','REQUESTED','Concurrent finance review',?,?,?)",
                  )
                  .bind(crypto.randomUUID(), paymentId, crypto.randomUUID(), Date.now(), Date.now())
                  .run();
              return target.batch(statements);
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await applyAmendmentPaymentReaction(db, {
          reactionId: reaction.id,
          paymentIntentId: paymentId,
          amendmentId: addition.value.amendmentId,
          canonicalPaymentState: "SUCCEEDED",
        }),
      ).toMatchObject({ applied: false });
      expect(
        await env.DB.prepare("SELECT status FROM paid_order_amendment WHERE id=?")
          .bind(addition.value.amendmentId)
          .first(),
      ).toEqual({ status: "PENDING_PAYMENT" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM committed_demand WHERE amendment_line_id IN (SELECT id FROM paid_order_amendment_line WHERE amendment_id=?)",
        )
          .bind(addition.value.amendmentId)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
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
    const logistics = await env.DB.prepare(
      "SELECT base_unit_code_snapshot AS baseUnitCode, shipping_weight_grams AS shippingWeightGrams FROM paid_order_amendment_line WHERE amendment_id=?",
    )
      .bind(result.value.amendmentId)
      .first<{ baseUnitCode: string | null; shippingWeightGrams: number | null }>();
    expect(logistics).toEqual({ baseUnitCode: "GRAM", shippingWeightGrams: 1_000 });

    // Original commercial history unchanged.
    const after = await env.DB.prepare("SELECT total_minor FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ total_minor: number }>();
    expect(after?.total_minor).toBe(before?.total_minor);

    const provider = createMockPaymentProvider();
    const registry = new ProviderRegistry("test", [provider]);
    const payment = await createAmendmentPaymentIntent(env.DB, registry, "mock", {
      customerId: fixture.customerId,
      amendmentId: result.value.amendmentId,
      expectedAmendmentVersion: result.value.version,
      expectedCurrency: result.value.financial.currency,
      expectedTotalMinor: result.value.financial.totalMinor,
      returnUrl: "https://freshmarkets.ph/orders",
      idempotencyKey: `amendment-payment-${crypto.randomUUID()}`,
      requestId: "amendment-payment",
      headers: {},
    });
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

    if (!payment.ok) throw new Error("Payment initiation failed");
    const intentId = payment.value.paymentIntentId;
    const attempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ provider_reference: string }>();
    if (!attempt) throw new Error("Payment attempt missing");
    setMockObservedState(provider, attempt.provider_reference, "SUCCEEDED");
    await reconcilePayment(env.DB, registry, {
      paymentIntentId: intentId,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: "test",
    });
    const reaction = await env.DB.prepare(
      "SELECT id FROM payment_reaction WHERE payment_intent_id=? AND reaction_type='COMMIT_AMENDMENT'",
    )
      .bind(intentId)
      .first<{ id: string }>();
    if (!reaction) throw new Error("Canonical payment reaction missing");
    const command = {
      reactionId: reaction.id,
      paymentIntentId: intentId,
      amendmentId: result.value.amendmentId,
      canonicalPaymentState: "SUCCEEDED" as const,
    };
    await env.DB.prepare("UPDATE order_item SET shipping_weight_grams=19500 WHERE order_id=?")
      .bind(fixture.orderId)
      .run();
    expect(await applyAmendmentPaymentReaction(env.DB, command)).toEqual({
      applied: false,
      reason: "CAS_CONFLICT",
    });
    expect(
      await env.DB.prepare("SELECT id FROM committed_demand WHERE order_id=?")
        .bind(fixture.orderId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT status FROM paid_order_amendment WHERE id=?")
        .bind(result.value.amendmentId)
        .first(),
    ).toEqual({ status: "PENDING_PAYMENT" });
    await env.DB.prepare("UPDATE order_item SET shipping_weight_grams=1000 WHERE order_id=?")
      .bind(fixture.orderId)
      .run();
    await env.DB.prepare("UPDATE payment_intent SET status='PROCESSING' WHERE id=?")
      .bind(intentId)
      .run();
    expect(await applyAmendmentPaymentReaction(env.DB, command)).toEqual({
      applied: false,
      reason: "INSUFFICIENT_STATE",
    });
    await env.DB.prepare("UPDATE payment_intent SET status='SUCCEEDED' WHERE id=?")
      .bind(intentId)
      .run();
    await env.DB.prepare("UPDATE grocery_order SET status='CANCELED' WHERE id=?")
      .bind(fixture.orderId)
      .run();
    expect(await applyAmendmentPaymentReaction(env.DB, command)).toEqual({
      applied: false,
      reason: "CAS_CONFLICT",
    });
    expect(
      await env.DB.prepare("SELECT status FROM paid_order_amendment WHERE id=?")
        .bind(command.amendmentId)
        .first(),
    ).toEqual({ status: "PENDING_PAYMENT" });
    await env.DB.prepare("UPDATE grocery_order SET status='COMMITTED' WHERE id=?")
      .bind(fixture.orderId)
      .run();
    await env.DB.prepare(`CREATE TRIGGER lose_amendment_claim BEFORE UPDATE ON paid_order_amendment
      WHEN NEW.id='${result.value.amendmentId}' AND NEW.status='COMMITTED' BEGIN SELECT RAISE(IGNORE); END`).run();
    try {
      expect(await applyAmendmentPaymentReaction(env.DB, command)).toEqual({
        applied: false,
        reason: "CAS_CONFLICT",
      });
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM committed_demand WHERE order_id=?")
          .bind(fixture.orderId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
          .bind(reaction.id)
          .first(),
      ).toEqual({ status: "PENDING" });
    } finally {
      await env.DB.exec("DROP TRIGGER lose_amendment_claim");
    }
    const outcomes = await Promise.all([
      applyAmendmentPaymentReaction(env.DB, command),
      applyAmendmentPaymentReaction(env.DB, command),
    ]);
    expect(outcomes.filter((value) => value.reason === "APPLIED")).toHaveLength(1);
    expect(outcomes.every((value) => value.applied)).toBe(true);
    const outcome = outcomes.find((value) => value.reason === "APPLIED");
    expect(
      await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
        .bind(reaction.id)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    // Additive delta lands on the same order's operational records.
    const demand = await env.DB.prepare(
      `SELECT COALESCE(SUM(quantity),0) AS total,MIN(demand_basis) AS basis,
       MIN(sku_id) AS skuId,MIN(quantity_sellable) AS sellable,
       MIN(shipping_weight_grams) AS shippingWeight
       FROM committed_demand WHERE order_id=?`,
    )
      .bind(fixture.orderId)
      .first<{
        total: number;
        basis: string;
        skuId: string;
        sellable: number;
        shippingWeight: number;
      }>();
    expect(demand).toMatchObject({
      total: 1000,
      basis: "EXACT_PAID_LINE",
      skuId: fixture.skuId,
      sellable: 2,
      shippingWeight: 1000,
    });
    await expect(resolveOrderDeliveryPackage(env.DB, fixture.orderId)).resolves.toEqual({
      ok: true,
      value: { kind: "BAG", quantity: 1, weightGrams: 2_000 },
    });
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
  it("holds the last weight allowance across competing and unknown payment outcomes", async () => {
    const f = await committedOrder();
    await env.DB.prepare("UPDATE order_item SET shipping_weight_grams=19000 WHERE order_id=?")
      .bind(f.orderId)
      .run();
    const draft = (version: number, quantity: number) =>
      createOrderAmendment(env.DB, {
        customerId: f.customerId,
        orderId: f.orderId,
        expectedOrderVersion: version,
        additions: [{ skuId: f.skuId, quantity }],
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      });
    expect(await draft(5, 3)).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const first = await draft(5, 2);
    if (!first.ok) throw new Error(first.error.message);
    // Retained competing drafts exercise payment admission independently of the
    // current one-active-addition UI/command rule.
    const secondId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO paid_order_amendment (id,order_id,status,currency,total_minor,merchandise_subtotal_minor,idempotency_key,created_at,updated_at) SELECT ?,order_id,status,currency,total_minor,merchandise_subtotal_minor,?,created_at,updated_at FROM paid_order_amendment WHERE id=?",
    )
      .bind(secondId, crypto.randomUUID(), first.value.amendmentId)
      .run();
    await env.DB.prepare(
      "INSERT INTO paid_order_amendment_line (id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,base_unit_code_snapshot,shipping_weight_grams,unit_price_minor,line_total_minor,created_at) SELECT ?,?,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,base_unit_code_snapshot,shipping_weight_grams,unit_price_minor,line_total_minor,created_at FROM paid_order_amendment_line WHERE amendment_id=?",
    )
      .bind(crypto.randomUUID(), secondId, first.value.amendmentId)
      .run();
    const second = { ok: true as const, value: { ...first.value, amendmentId: secondId } };
    let submissions = 0;
    const provider = createMockPaymentProvider();
    provider.createPayment = async () => {
      submissions++;
      throw new Error("unknown provider response");
    };
    const registry = new ProviderRegistry("test", [provider]);
    const commands = [first, second].map((a) => ({
      customerId: f.customerId,
      amendmentId: a.value.amendmentId,
      expectedAmendmentVersion: a.value.version,
      expectedCurrency: "PHP",
      expectedTotalMinor: a.value.financial.totalMinor,
      returnUrl: "https://app.example/orders",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      headers: {},
    }));
    const results = await Promise.all(
      commands.map((c) => createAmendmentPaymentIntent(env.DB, registry, "mock", c)),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(submissions).toBe(1);
    const intents = await env.DB.prepare(
      "SELECT id,subject_id FROM payment_intent WHERE purpose='ORDER_AMENDMENT' AND customer_id=?",
    )
      .bind(f.customerId)
      .all<{ id: string; subject_id: string }>();
    expect(intents.results).toHaveLength(1);
    const winner = commands.find((c) => c.amendmentId === intents.results[0].subject_id)!;
    const loser = commands.find((c) => c !== winner)!;
    expect(await createAmendmentPaymentIntent(env.DB, registry, "mock", winner)).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_OUTCOME_UNRESOLVED" },
    });
    expect(await createAmendmentPaymentIntent(env.DB, registry, "mock", loser)).toMatchObject({
      ok: false,
    });
    expect(submissions).toBe(1);
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED' WHERE id=?")
      .bind(intents.results[0].id)
      .run();
    await createAmendmentPaymentIntent(env.DB, registry, "mock", loser);
    expect(submissions).toBe(2);
    expect(
      await env.DB.prepare("SELECT id FROM committed_demand WHERE order_id=?")
        .bind(f.orderId)
        .first(),
    ).toBeNull();
  });
});
