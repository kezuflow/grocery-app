import { describe, expect, it } from "vitest";
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
    "INSERT INTO cart_item (cart_id, sku_id, quantity) VALUES (?, 'sku-red-onion-500g', 5)",
  )
    .bind(cartId)
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

describe("instant order commitment", () => {
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

  it("enforces the location concurrent-order capacity", async () => {
    // Capacity is asserted relative to shared test state; never delete another
    // aggregate merely to isolate this fixture.
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
    const rejected = await applyCheckoutPaymentReaction(env.DB, {
      reactionId: secondReaction.reactionId,
      paymentIntentId: secondReaction.intentId,
      checkoutAttemptId: second.quoteId,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(rejected).toMatchObject({ applied: false, reason: "CAS_CONFLICT" });
    const orders = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_payment_reaction WHERE payment_intent_id IN (?,?)",
    )
      .bind(firstReaction.intentId, secondReaction.intentId)
      .first<{ count: number }>();
    expect(orders?.count).toBe(1);
    await env.DB.prepare("UPDATE grocery_order SET status='DELIVERED',version=version+1 WHERE id=?")
      .bind(ok.orderId ?? "missing")
      .run();
    expect(
      await applyCheckoutPaymentReaction(env.DB, {
        reactionId: secondReaction.reactionId,
        paymentIntentId: secondReaction.intentId,
        checkoutAttemptId: second.quoteId,
        canonicalPaymentState: "SUCCEEDED",
      }),
    ).toMatchObject({ applied: true, reason: "APPLIED" });
    await configureInstant(25);
  });
});
