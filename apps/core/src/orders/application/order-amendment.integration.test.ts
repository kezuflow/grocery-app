import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { requestRefund } from "../../payments/application/request-refund";
import { reconcileRefunds } from "../../payments/application/reconcile-refunds";
import { redrivePaymentReactions } from "../../payments/application/redrive-payment-reactions";
import { createOrderAmendment } from "./create-order-amendment";
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
      value: { kind: "BAG", quantity: 1, weightGrams: 1_000 },
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
});
