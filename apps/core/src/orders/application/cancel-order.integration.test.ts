import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { cancelOrder, applyOrderRefundObservation } from "./cancel-order";
import { advanceOrderCancellation } from "./advance-order-cancellation";

let counter = 0;
async function paidOrderFixture(options: { cutoffOffsetMs?: number } = {}) {
  const n = ++counter;
  const customerId = `cust-cancel-${n}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  const intentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 24000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(intentId, `cq-${intentId}`, customerId, `pi-${intentId}`, now, now)
    .run();
  const attemptId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 24000, 'PHP', 'SUCCEEDED', 'canonical', ?, ?, ?)",
  )
    .bind(attemptId, customerId, intentId, `pa-${intentId}`, now, now)
    .run();
  const orderId = crypto.randomUUID();
  const cycleId = (await env.DB.prepare(
    "SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1",
  ).first<{ id: string }>())!.id;
  await env.DB.prepare(
    "INSERT INTO grocery_order (id, customer_id, cycle_id, fulfillment_mode, address_snapshot_json, status, total_minor, currency, payment_id, created_at) VALUES (?, ?, ?, 'SCHEDULED', '{}', 'COMMITTED', 24000, 'PHP', ?, ?)",
  )
    .bind(orderId, customerId, cycleId, attemptId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO order_fulfillment_snapshot (order_id, location_id, cycle_id, zone_id, cutoff_at, delivery_date, fulfillment_mode, sourcing_modes_json, created_at) VALUES (?, 'location-cebu-central', ?, 'zone-cebu-city-core', ?, ?, 'SCHEDULED', '[\"STOCKED\"]', ?)",
  )
    .bind(orderId, cycleId, now + (options.cutoffOffsetMs ?? 86_400_000), now + 172_800_000, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO order_payment_reaction (id, payment_intent_id, reaction_id, order_id, applied_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), intentId, crypto.randomUUID(), orderId, now)
    .run();
  // One stocked reservation to prove release on terminal cancellation.
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES ('location-cebu-central', 'pool-red-onion', 50000, 1000, 1) ON CONFLICT(location_id, inventory_pool_id) DO UPDATE SET on_hand=50000, reserved=1000",
  ).run();
  await env.DB.prepare(
    "INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', 1000, 'RESERVED')",
  )
    .bind(crypto.randomUUID(), orderId)
    .run();
  return { customerId, orderId, intentId };
}

async function addCommittedAmendment(
  fixture: Awaited<ReturnType<typeof paidOrderFixture>>,
  amountMinor: number,
) {
  const now = Date.now();
  const intentId = crypto.randomUUID();
  const amendmentId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_intent (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'ORDER_AMENDMENT','paid_order_amendment',?,?,?,'PHP','SUCCEEDED',?,1,?,?)",
    ).bind(intentId, amendmentId, fixture.customerId, amountMinor, `pi-${intentId}`, now, now),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,'PHP','SUCCEEDED','mock',?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      fixture.customerId,
      intentId,
      amountMinor,
      `mock_pay_${intentId}`,
      `pa-${intentId}`,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO paid_order_amendment (id,order_id,status,currency,total_minor,payment_intent_id,idempotency_key,created_at,updated_at,version,committed_at) VALUES (?,?,'COMMITTED','PHP',?,?,?, ?,?,1,?)",
    ).bind(
      amendmentId,
      fixture.orderId,
      amountMinor,
      intentId,
      `amend-${amendmentId}`,
      now,
      now,
      now,
    ),
  ]);
  return intentId;
}

function command(orderId: string): Parameters<typeof cancelOrder>[1] {
  return {
    orderId,
    expectedVersion: 1,
    reasonCode: "customer-changed-mind",
    idempotencyKey: `cancel-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  };
}

describe("explicit cancellation and refund orchestration", () => {
  it("coordinates the original payment and every committed addition before canceling", async () => {
    const fixture = await paidOrderFixture();
    const amendmentOne = await addCommittedAmendment(fixture, 5_000);
    const amendmentTwo = await addCommittedAmendment(fixture, 7_000);
    const refundIds = new Map<string, string>();
    const result = await cancelOrder(env.DB, command(fixture.orderId), {
      requestRefund: async (input) => {
        const refundId = crypto.randomUUID();
        refundIds.set(input.paymentIntentId, refundId);
        await env.DB.prepare(
          "INSERT INTO payment_refund (id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?,?,?,'PHP','PROCESSING',?,?,1,?,?)",
        )
          .bind(
            refundId,
            input.paymentIntentId,
            input.amountMinor,
            input.reason,
            input.idempotencyKey,
            Date.now(),
            Date.now(),
          )
          .run();
        return { ok: true as const, refundId, refundState: "PROCESSING" as const };
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: { requiredRefundMinor: 36_000, refunds: { length: 3 } },
    });
    const paymentIds = [fixture.intentId, amendmentOne, amendmentTwo];
    for (const [index, paymentIntentId] of paymentIds.entries()) {
      const refundId = refundIds.get(paymentIntentId)!;
      await env.DB.prepare("UPDATE payment_refund SET status='SUCCEEDED' WHERE id=?")
        .bind(refundId)
        .run();
      const advanced = await advanceOrderCancellation(env.DB, {
        paymentIntentId,
        refundId,
        refundState: "SUCCEEDED",
      });
      expect(advanced.completed).toBe(index === paymentIds.length - 1);
      const order = await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first<{ status: string }>();
      expect(order?.status).toBe(
        index === paymentIds.length - 1 ? "CANCELED" : "CANCELLATION_REQUESTED",
      );
    }
  });

  it("requests a canonical refund for a paid pre-cutoff order and finalizes from the observation", async () => {
    const fixture = await paidOrderFixture();
    const refundsRequested: string[] = [];
    const result = await cancelOrder(env.DB, command(fixture.orderId), {
      requestRefund: async (input) => {
        refundsRequested.push(input.paymentIntentId);
        const refundId = crypto.randomUUID();
        // Simulate the provider accepting the refund request.
        await env.DB.prepare(
          "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, provider_refund_reference, version, created_at, updated_at) VALUES (?, ?, ?, 'PHP', 'PROCESSING', ?, ?, ?, 1, ?, ?)",
        )
          .bind(
            refundId,
            input.paymentIntentId,
            input.amountMinor,
            input.reason,
            input.idempotencyKey,
            `mock_refund_${input.idempotencyKey}`,
            Date.now(),
            Date.now(),
          )
          .run();
        return { ok: true, refundId, refundState: "PROCESSING" as const };
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result).toMatchObject({
      ok: true,
      value: { state: "CANCELLATION_REQUESTED", refundState: "PROCESSING" },
    });
    expect(refundsRequested).toEqual([fixture.intentId]);
    // Operational commitments release when cancellation is accepted.
    const reservedBefore = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
    )
      .bind(fixture.orderId)
      .first<{ total: number }>();
    expect(reservedBefore?.total).toBe(0);

    // Canonical refund success observation finalizes the order.
    const refund = await env.DB.prepare("SELECT id FROM payment_refund WHERE payment_intent_id=?")
      .bind(fixture.intentId)
      .first<{ id: string }>();
    await env.DB.prepare("UPDATE payment_refund SET status='SUCCEEDED' WHERE id=?")
      .bind(refund!.id)
      .run();
    const observation = await applyOrderRefundObservation(env.DB, {
      paymentIntentId: fixture.intentId,
      refundId: refund!.id,
    });
    expect(observation.applied).toBe(true);
    const row = await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ status: string }>();
    expect(row?.status).toBe("CANCELED");
    const reservedAfter = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
    )
      .bind(fixture.orderId)
      .first<{ total: number }>();
    expect(reservedAfter?.total).toBe(0);
  });

  it("retains the snapshotted Instant Service Fee only for a customer cancellation", async () => {
    const fixture = await paidOrderFixture();
    await env.DB.prepare(
      "UPDATE grocery_order SET fulfillment_mode='INSTANT',cycle_id=NULL,service_fee_minor=2500 WHERE id=?",
    )
      .bind(fixture.orderId)
      .run();
    let requestedAmount = -1;

    const result = await cancelOrder(env.DB, command(fixture.orderId), {
      requestRefund: async (input) => {
        requestedAmount = input.amountMinor;
        return { ok: true, refundState: "PROCESSING" as const };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { requiredRefundMinor: 21_500, retainedServiceFeeMinor: 2_500 },
    });
    expect(requestedAmount).toBe(21_500);
  });

  it("refunds the full Instant payment when FreshMarkets causes the cancellation", async () => {
    const fixture = await paidOrderFixture();
    await env.DB.prepare(
      "UPDATE grocery_order SET fulfillment_mode='INSTANT',cycle_id=NULL,service_fee_minor=2500,status='FULFILLMENT_PENDING' WHERE id=?",
    )
      .bind(fixture.orderId)
      .run();
    let requestedAmount = -1;

    const result = await cancelOrder(
      env.DB,
      {
        ...command(fixture.orderId),
        actor: "BUSINESS",
        cause: "STOCK_UNAVAILABLE",
        reason: "Stock became unavailable during picking",
      },
      {
        requestRefund: async (input) => {
          requestedAmount = input.amountMinor;
          return { ok: true, refundState: "PROCESSING" as const };
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { requiredRefundMinor: 24_000, retainedServiceFeeMinor: 0 },
    });
    expect(requestedAmount).toBe(24_000);
  });

  it("rejects post-cutoff paid cancellation to manual review", async () => {
    const fixture = await paidOrderFixture({ cutoffOffsetMs: -86_400_000 });
    const outcome = await cancelOrder(env.DB, command(fixture.orderId));
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "FINANCIAL_OPERATION_REQUIRES_REVIEW" },
    });
    const row = await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ status: string }>();
    expect(row?.status).toBe("COMMITTED");
  });

  it("routes an order with an existing refund to financial review", async () => {
    const fixture = await paidOrderFixture();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO payment_refund (id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?,?,500,'PHP','PROCESSING','goodwill',?,1,?,?)",
    )
      .bind(crypto.randomUUID(), fixture.intentId, `existing-${crypto.randomUUID()}`, now, now)
      .run();

    const outcome = await cancelOrder(env.DB, command(fixture.orderId));

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "FINANCIAL_OPERATION_REQUIRES_REVIEW" },
    });
  });

  it("enforces optimistic versions and replays the same key identically", async () => {
    const fixture = await paidOrderFixture();
    const stale = await cancelOrder(env.DB, { ...command(fixture.orderId), expectedVersion: 9 });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const attempt = command(fixture.orderId);
    const first = await cancelOrder(env.DB, attempt, {
      requestRefund: async () => ({ ok: true, refundState: "PROCESSING" as const }),
    });
    expect(first.ok).toBe(true);
    const replayed = await cancelOrder(env.DB, attempt);
    // Replay resolves the same logical outcome without re-triggering refunds.
    expect(replayed.ok).toBe(true);
    if (replayed.ok && first.ok) {
      expect(replayed.value.state).toBe(first.value.state);
      expect(replayed.value.refundState ?? first.value.refundState).toBeTruthy();
    }
  });

  it("does not reveal or mutate an order owned by another customer", async () => {
    const fixture = await paidOrderFixture();
    const outcome = await cancelOrder(env.DB, {
      ...command(fixture.orderId),
      customerId: "another-customer",
    });

    expect(outcome).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const order = await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
      .bind(fixture.orderId)
      .first<{ status: string; version: number }>();
    expect(order).toEqual({ status: "COMMITTED", version: 1 });
  });

  it.each([
    ["OUT_FOR_DELIVERY", "FINANCIAL_OPERATION_REQUIRES_REVIEW"],
    ["DELIVERED", "ILLEGAL_TRANSITION"],
    ["CANCELED", "ILLEGAL_TRANSITION"],
    ["EXPIRED", "ILLEGAL_TRANSITION"],
  ])(
    "rejects cancellation from the terminal or late lifecycle state %s",
    async (status, expectedCode) => {
      const fixture = await paidOrderFixture();
      await env.DB.prepare("UPDATE grocery_order SET status=? WHERE id=?")
        .bind(status, fixture.orderId)
        .run();

      const outcome = await cancelOrder(env.DB, command(fixture.orderId));

      expect(outcome).toMatchObject({ ok: false, error: { code: expectedCode } });
      const row = await env.DB.prepare("SELECT status, version FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first<{ status: string; version: number }>();
      expect(row).toEqual({ status, version: 1 });
    },
  );

  it("leaves operational commitments untouched when the cancellation CAS loses", async () => {
    const fixture = await paidOrderFixture();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM order_payment_reaction WHERE order_id=?").bind(fixture.orderId),
      env.DB.prepare("UPDATE grocery_order SET status='PENDING_PAYMENT' WHERE id=?").bind(
        fixture.orderId,
      ),
    ]);
    await env.DB.prepare(
      `CREATE TRIGGER ignore_stale_cancel BEFORE UPDATE OF status ON grocery_order
       WHEN OLD.id='${fixture.orderId}' AND NEW.status='CANCELED'
       BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    const balanceBefore = await env.DB.prepare(
      "SELECT reserved, version FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
    ).first<{ reserved: number; version: number }>();

    const outcome = await cancelOrder(env.DB, command(fixture.orderId));

    expect(outcome).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    const reservation = await env.DB.prepare(
      "SELECT status FROM inventory_reservation WHERE order_id=?",
    )
      .bind(fixture.orderId)
      .first<{ status: string }>();
    const balance = await env.DB.prepare(
      "SELECT reserved, version FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
    ).first<{ reserved: number; version: number }>();
    expect(reservation?.status).toBe("RESERVED");
    expect(balance).toEqual(balanceBefore);
  });
});
