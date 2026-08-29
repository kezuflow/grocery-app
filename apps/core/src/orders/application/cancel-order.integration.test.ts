import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { cancelOrder, applyOrderRefundObservation } from "./cancel-order";

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
  it("requests a canonical refund for a paid pre-cutoff order and finalizes from the observation", async () => {
    const fixture = await paidOrderFixture();
    const refundsRequested: string[] = [];
    const result = await cancelOrder(env.DB, command(fixture.orderId), {
      requestRefund: async (input) => {
        refundsRequested.push(input.paymentIntentId);
        // Simulate the provider accepting the refund request.
        await env.DB.prepare(
          "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, provider_refund_reference, version, created_at, updated_at) VALUES (?, ?, ?, 'PHP', 'PROCESSING', ?, ?, ?, 1, ?, ?)",
        ).bind(
          crypto.randomUUID(),
          input.paymentIntentId,
          input.amountMinor,
          input.reason,
          input.idempotencyKey,
          `mock_refund_${input.idempotencyKey}`,
          Date.now(),
          Date.now(),
        );
        return { ok: true, refundState: "PROCESSING" as const };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { state: "CANCELLATION_REQUESTED", refundState: "PROCESSING" },
    });
    expect(refundsRequested).toEqual([fixture.intentId]);
    // Operational state stays untouched until the refund observation lands.
    const reservedBefore = await env.DB.prepare(
      "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND status='RESERVED'",
    )
      .bind(fixture.orderId)
      .first<{ total: number }>();
    expect(reservedBefore?.total).toBe(1000);

    // Canonical refund success observation finalizes the order.
    await env.DB.prepare("UPDATE payment_intent SET status='REFUNDED' WHERE id=?")
      .bind(fixture.intentId)
      .run();
    const observation = await applyOrderRefundObservation(env.DB, {
      paymentIntentId: fixture.intentId,
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

  it.each(["OUT_FOR_DELIVERY", "DELIVERED", "CANCELED", "EXPIRED"])(
    "rejects cancellation from the terminal or late lifecycle state %s",
    async (status) => {
      const fixture = await paidOrderFixture();
      await env.DB.prepare("UPDATE grocery_order SET status=? WHERE id=?")
        .bind(status, fixture.orderId)
        .run();

      const outcome = await cancelOrder(env.DB, command(fixture.orderId));

      expect(outcome).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
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
