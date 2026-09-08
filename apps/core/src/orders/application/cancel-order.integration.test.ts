import { buildCancellationRefundSet } from "./build-cancellation-refund-set";
import { advanceFulfillment } from "../../operations/application/advance-fulfillment";
import { reconcileRefunds } from "../../payments/application/reconcile-refunds";
import { setMockRefundObservation } from "../../payments/infrastructure/providers/mock-payment-provider";
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { resumeCancellationRefunds } from "./resume-cancellation-refunds";
import { getJobsForCron } from "../../scheduling/job-registry";
import { runRegisteredJobs } from "../../scheduling/run-scheduled-jobs";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { requestRefund } from "../../payments/application/request-refund";
import { requestHash } from "../../idempotency";
import { cancelOrder, applyOrderRefundObservation } from "./cancel-order";
import {
  advanceOrderCancellation,
  synchronizeOrderCancellationForPayment,
} from "./advance-order-cancellation";

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
  it.each([-1, 0, 1])(
    "uses the Scheduled cutoff with earlier preparation at offset %s",
    async (offset) => {
      const fixture = await paidOrderFixture();
      const cutoffAt = Date.now() + 86_400_000;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,'location-cebu-central','NOT_STARTED',1,?)",
        ).bind(crypto.randomUUID(), fixture.orderId, Date.now()),
        env.DB.prepare("UPDATE order_fulfillment_snapshot SET cutoff_at=? WHERE order_id=?").bind(
          cutoffAt,
          fixture.orderId,
        ),
      ]);
      expect(
        await advanceFulfillment(
          env.DB,
          {
            orderId: fixture.orderId,
            action: "START_PICKING",
            headers: {},
            expectedVersion: 1,
            idempotencyKey: `accept-${fixture.orderId}`,
            requestId: crypto.randomUUID(),
          },
          { authorize: async () => true },
        ),
      ).toMatchObject({ ok: true, value: { status: "PICKING" } });
      const request = { ...command(fixture.orderId), expectedVersion: 2 };
      const submitted: number[] = [];
      const result = await cancelOrder(env.DB, request, {
        now: () => cutoffAt + offset,
        requestRefund: async (input) => {
          submitted.push(input.amountMinor);
          return { ok: true, refundState: "PROCESSING" };
        },
      });
      if (offset < 0) {
        expect(result).toMatchObject({
          ok: true,
          value: { status: "REQUESTED", requiredRefundMinor: 24_000 },
        });
        expect(submitted).toEqual([24_000]);
        expect(await cancelOrder(env.DB, request)).toEqual(result);
      } else {
        expect(result).toMatchObject({ ok: false });
        expect(submitted).toEqual([]);
        expect(
          await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
            .bind(fixture.orderId)
            .first(),
        ).toEqual({ status: "FULFILLMENT_PENDING", version: 2 });
        expect(
          await env.DB.prepare("SELECT id FROM order_cancellation WHERE order_id=?")
            .bind(fixture.orderId)
            .first(),
        ).toBeNull();
        expect(
          await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
            .bind(request.idempotencyKey)
            .first(),
        ).toBeNull();
      }
    },
  );

  it("rejects a customer cancellation without paid evidence before any effect", async () => {
    const fixture = await paidOrderFixture(),
      request = command(fixture.orderId);
    await env.DB.prepare("DELETE FROM order_payment_reaction WHERE order_id=?")
      .bind(fixture.orderId)
      .run();
    await env.DB.prepare("UPDATE grocery_order SET status='PENDING_PAYMENT' WHERE id=?")
      .bind(fixture.orderId)
      .run();
    expect(
      await cancelOrder(env.DB, {
        ...request,
        customerId: fixture.customerId,
        actorAuthUserId: `auth-${fixture.customerId}`,
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(
      await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "PENDING_PAYMENT", version: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toBeNull();
  });

  it("recovers an unapplied legacy claim and does not replay historical success as current state", async () => {
    const fixture = await paidOrderFixture(),
      request = command(fixture.orderId),
      now = Date.now();
    const hash = await requestHash({
      orderId: request.orderId,
      expectedVersion: request.expectedVersion,
      actor: "CUSTOMER",
      cause: "CUSTOMER_REQUEST",
      reason: request.reasonCode,
    });
    await env.DB.prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES ('orders.cancel',?,?,'PROCESSING','order_cancellation',?,?)",
    )
      .bind(request.idempotencyKey, hash, now, now)
      .run();
    const accepted = await cancelOrder(env.DB, request);
    expect(accepted.ok).toBe(true);
    expect(await cancelOrder(env.DB, request)).toEqual(accepted);
    await env.DB.prepare(
      "UPDATE idempotency_records SET result_reference=? WHERE scope='orders.cancel' AND idempotency_key=?",
    )
      .bind(fixture.orderId, request.idempotencyKey)
      .run();
    expect(await cancelOrder(env.DB, request)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM order_cancellation WHERE order_id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it.each([-1, 0, 1])(
    "enforces the Scheduled cancellation cutoff at offset %sms",
    async (offset) => {
      const fixture = await paidOrderFixture();
      const snapshot = await env.DB.prepare(
        "SELECT cutoff_at FROM order_fulfillment_snapshot WHERE order_id=?",
      )
        .bind(fixture.orderId)
        .first<{ cutoff_at: number }>();
      if (!snapshot) throw new Error("Cutoff missing");
      const request = command(fixture.orderId);
      const result = await cancelOrder(env.DB, request, { now: () => snapshot.cutoff_at + offset });
      expect(result.ok).toBe(offset < 0);
      if (offset >= 0) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: "FINANCIAL_OPERATION_REQUIRES_REVIEW" },
        });
        expect(
          await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
            .bind(request.idempotencyKey)
            .first(),
        ).toBeNull();
      }
    },
  );

  it.each(["scope", "permission", "staff", "addition", "refund", "late-failure"] as const)(
    "rolls back cancellation admission after %s changes",
    async (kind) => {
      const fixture = await paidOrderFixture(),
        manager = await locationManager("global");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='orders.manage'",
      )
        .bind(manager.id)
        .run();
      const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
        .bind(manager.id)
        .first<{ auth_user_id: string }>();
      if (!actor) throw new Error("Actor missing");
      const request = {
        ...command(fixture.orderId),
        actor: "BUSINESS" as const,
        actorAuthUserId: actor.auth_user_id,
      };
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "permission")
                await target
                  .prepare("DELETE FROM role_permission WHERE role_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "staff")
                await target
                  .prepare("UPDATE staff_identity SET status='inactive' WHERE id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "addition") await addCommittedAmendment(fixture, 100);
              if (kind === "refund")
                await target
                  .prepare(
                    "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?,?,100,'PHP','PROCESSING','Race',?,1,?,?)",
                  )
                  .bind(
                    crypto.randomUUID(),
                    fixture.intentId,
                    crypto.randomUUID(),
                    Date.now(),
                    Date.now(),
                  )
                  .run();
              return target.batch(
                kind === "late-failure"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)")]
                  : statements,
              );
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect((await cancelOrder(database, request)).ok).toBe(false);
      expect(reached).toBe(true);
      expect(
        await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
          .bind(fixture.orderId)
          .first(),
      ).toEqual({ status: "COMMITTED", version: 1 });
      expect(
        await env.DB.prepare("SELECT id FROM order_cancellation WHERE order_id=?")
          .bind(fixture.orderId)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
          .bind(request.idempotencyKey)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?")
          .bind(request.idempotencyKey)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT status FROM inventory_reservation WHERE order_id=?")
          .bind(fixture.orderId)
          .first(),
      ).toEqual({ status: "RESERVED" });
      if (kind === "late-failure") expect((await cancelOrder(env.DB, request)).ok).toBe(true);
    },
  );

  it("recovers an accepted but unsubmitted cancellation through the registered job and preserves replay", async () => {
    const fixture = await paidOrderFixture(),
      request = command(fixture.orderId);
    await env.DB.prepare(
      "UPDATE payment_attempt SET provider='mock',provider_reference=? WHERE payment_intent_id=?",
    )
      .bind(`mock-${fixture.intentId}`, fixture.intentId)
      .run();
    const accepted = await cancelOrder(env.DB, request);
    expect(accepted).toMatchObject({ ok: true, value: { status: "REQUESTED" } });
    const job = getJobsForCron("* * * * *").find(
      (job) => job.name === "orders.cancellation-refunds",
    );
    if (!job) throw new Error("Recovery job not registered");
    const registry = new ProviderRegistry("test", [createMockPaymentProvider()]);
    expect(
      await requestRefund(env.DB, registry, {
        paymentIntentId: fixture.intentId,
        amountMinor: 100,
        reason: "Competing refund",
        idempotencyKey: crypto.randomUUID(),
        actorId: "test-operator",
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "REFUND_AMOUNT_UNAVAILABLE" } });
    const run = () => runRegisteredJobs(env.DB, "* * * * *", Date.now(), [job], registry);
    expect(await run()).toMatchObject([{ status: "SUCCEEDED" }]);
    expect(
      await env.DB.prepare(
        "SELECT attempts,status FROM order_cancellation_refund_member WHERE payment_intent_id=?",
      )
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ attempts: 1, status: "PROCESSING" });
    expect(await run()).toMatchObject([{ status: "SUCCEEDED", affected: 0 }]);
    expect(await cancelOrder(env.DB, request)).toEqual(accepted);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM payment_refund WHERE payment_intent_id=?")
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("bounds failed submission retries and prevents competing recovery from submitting twice", async () => {
    const fixture = await paidOrderFixture(),
      result = await cancelOrder(env.DB, command(fixture.orderId));
    if (!result.ok || !result.value.cancellationId) throw new Error("Cancellation missing");
    let calls = 0;
    const send = async () => {
      calls++;
      return { ok: false };
    };
    const now = Date.now();
    await Promise.all([
      resumeCancellationRefunds(env.DB, result.value.cancellationId, send, now),
      resumeCancellationRefunds(env.DB, result.value.cancellationId, send, now),
    ]);
    expect(calls).toBe(1);
    for (let attempt = 1; attempt < 8; attempt++)
      await resumeCancellationRefunds(
        env.DB,
        result.value.cancellationId,
        send,
        now + attempt * 60000,
      );
    expect(calls).toBe(5);
    expect(
      await env.DB.prepare("SELECT status FROM order_cancellation WHERE id=?")
        .bind(result.value.cancellationId)
        .first(),
    ).toEqual({ status: "EXCEPTION" });
  });

  it("completes competing original/addition observations once", async () => {
    const fixture = await paidOrderFixture();
    const addition = await addCommittedAmendment(fixture, 5000);
    const cancellation = await cancelOrder(env.DB, command(fixture.orderId));
    if (!cancellation.ok || !cancellation.value.cancellationId)
      throw new Error("Cancellation missing");
    const now = Date.now();
    for (const [paymentId, amount] of [
      [fixture.intentId, 24000],
      [addition, 5000],
    ] as const)
      await env.DB.prepare(`INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at)
        VALUES (?,?,?,'PHP','SUCCEEDED','Cancellation',?,1,?,?)`)
        .bind(
          crypto.randomUUID(),
          paymentId,
          amount,
          `order-cancel:${cancellation.value.cancellationId}:${paymentId}`,
          now,
          now,
        )
        .run();
    const before = await env.DB.prepare("SELECT version FROM order_cancellation WHERE id=?")
      .bind(cancellation.value.cancellationId)
      .first<{ version: number }>();
    await Promise.all(
      [fixture.intentId, addition, fixture.intentId, addition].map((paymentId) =>
        synchronizeOrderCancellationForPayment(env.DB, paymentId),
      ),
    );
    expect(
      await env.DB.prepare("SELECT status,version FROM order_cancellation WHERE id=?")
        .bind(cancellation.value.cancellationId)
        .first(),
    ).toEqual({ status: "COMPLETED", version: before!.version + 1 });
    expect(
      await env.DB.prepare("SELECT status,version FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "CANCELED", version: 3 });
  });

  it("keeps canonical completion when refund submission returns after its success observation", async () => {
    const fixture = await paidOrderFixture();
    const result = await cancelOrder(env.DB, command(fixture.orderId), {
      requestRefund: async (input) => {
        const id = crypto.randomUUID(),
          now = Date.now();
        await env.DB.prepare(`INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at)
          VALUES (?,?,?,'PHP','SUCCEEDED',?,?,1,?,?)`)
          .bind(
            id,
            input.paymentIntentId,
            input.amountMinor,
            input.reason,
            input.idempotencyKey,
            now,
            now,
          )
          .run();
        await synchronizeOrderCancellationForPayment(env.DB, input.paymentIntentId);
        return { ok: true, refundId: id, refundState: "PROCESSING" };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        state: "CANCELLATION_REQUESTED",
        status: "REQUESTED",
        refunds: [{ status: "NOT_REQUESTED" }],
      },
    });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "CANCELED" });
    expect(
      await env.DB.prepare("SELECT status FROM order_cancellation WHERE order_id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "COMPLETED" });
    expect(
      await env.DB.prepare(
        "SELECT status FROM order_cancellation_refund_member WHERE payment_intent_id=?",
      )
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
  });

  it("recovers an unlinked refund from canonical identity and ignores stale observation state", async () => {
    const fixture = await paidOrderFixture();
    const canceled = await cancelOrder(env.DB, command(fixture.orderId));
    if (!canceled.ok || !canceled.value.cancellationId)
      throw new Error("Cancellation fixture failed");
    const refundId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at)
      VALUES (?, ?,24000,'PHP','PROCESSING','Cancellation',?,1,?,?)`)
      .bind(
        refundId,
        fixture.intentId,
        `order-cancel:${canceled.value.cancellationId}:${fixture.intentId}`,
        Date.now(),
        Date.now(),
      )
      .run();
    // A provider handler's stale/premature argument cannot manufacture canonical success.
    expect(
      await advanceOrderCancellation(env.DB, {
        paymentIntentId: fixture.intentId,
        refundId,
        refundState: "SUCCEEDED",
      }),
    ).toEqual({ applied: true, completed: false });
    expect(
      await env.DB.prepare(
        "SELECT status,refund_id FROM order_cancellation_refund_member WHERE cancellation_id=?",
      )
        .bind(canceled.value.cancellationId)
        .first(),
    ).toEqual({ status: "PROCESSING", refund_id: refundId });
    await env.DB.prepare("UPDATE payment_refund SET status='SUCCEEDED' WHERE id=?")
      .bind(refundId)
      .run();
    await synchronizeOrderCancellationForPayment(env.DB, fixture.intentId);
    expect(
      await advanceOrderCancellation(env.DB, {
        paymentIntentId: fixture.intentId,
        refundId,
        refundState: "FAILED",
      }),
    ).toEqual({ applied: false, completed: true });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "CANCELED" });
  });

  it("does not attach another refund and rolls back all projections when Order completion loses", async () => {
    const fixture = await paidOrderFixture();
    const canceled = await cancelOrder(env.DB, command(fixture.orderId));
    if (!canceled.ok || !canceled.value.cancellationId)
      throw new Error("Cancellation fixture failed");
    const unrelated = crypto.randomUUID(),
      refundId = crypto.randomUUID(),
      now = Date.now();
    for (const [id, key] of [
      [unrelated, `unrelated:${unrelated}`],
      [refundId, `order-cancel:${canceled.value.cancellationId}:${fixture.intentId}`],
    ])
      await env.DB.prepare(`INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at)
        VALUES (?, ?,24000,'PHP','SUCCEEDED','Cancellation',?,1,?,?)`)
        .bind(id, fixture.intentId, key, now, now)
        .run();
    expect(
      await advanceOrderCancellation(env.DB, {
        paymentIntentId: fixture.intentId,
        refundId: unrelated,
        refundState: "SUCCEEDED",
      }),
    ).toEqual({ applied: false, completed: false });
    await env.DB.exec(
      "CREATE TRIGGER test_lost_refund_projection BEFORE UPDATE OF status ON grocery_order WHEN NEW.status='CANCELED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      await expect(
        synchronizeOrderCancellationForPayment(env.DB, fixture.intentId),
      ).rejects.toThrow();
      expect(
        await env.DB.prepare(
          "SELECT status,refund_id FROM order_cancellation_refund_member WHERE cancellation_id=?",
        )
          .bind(canceled.value.cancellationId)
          .first(),
      ).toEqual({ status: "NOT_REQUESTED", refund_id: null });
      expect(
        await env.DB.prepare("SELECT status FROM order_cancellation WHERE id=?")
          .bind(canceled.value.cancellationId)
          .first(),
      ).toEqual({ status: "REFUNDS_PROCESSING" });
    } finally {
      await env.DB.exec("DROP TRIGGER test_lost_refund_projection");
    }
    await synchronizeOrderCancellationForPayment(env.DB, fixture.intentId);
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ status: "CANCELED" });
  });

  it("checks customer ownership even when replaying a successful cancellation", async () => {
    const fixture = await paidOrderFixture();
    const request = { ...command(fixture.orderId), customerId: fixture.customerId };
    expect(await cancelOrder(env.DB, request)).toMatchObject({ ok: true });
    expect(
      await cancelOrder(env.DB, { ...request, customerId: "different-customer" }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await cancelOrder(env.DB, request)).toMatchObject({ ok: true });
  });

  it("a lost Order claim cannot persist cancellation, release stock, or record success", async () => {
    const fixture = await paidOrderFixture();
    const request = command(fixture.orderId);
    // Model a zero-row conditional claim in the real D1 batch.
    await env.DB.exec(
      "CREATE TRIGGER test_lost_cancellation_claim BEFORE UPDATE OF status ON grocery_order WHEN NEW.status='CANCELLATION_REQUESTED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      const result = await cancelOrder(env.DB, request);
      expect(result.ok).toBe(false);
      expect(
        await env.DB.prepare("SELECT id FROM order_cancellation WHERE order_id=?")
          .bind(fixture.orderId)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT status FROM inventory_reservation WHERE order_id=?")
          .bind(fixture.orderId)
          .first(),
      ).toEqual({ status: "RESERVED" });
      expect(
        await env.DB.prepare(
          "SELECT status FROM idempotency_records WHERE scope='orders.cancel' AND idempotency_key=? AND status='SUCCEEDED'",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toBeNull();
    } finally {
      await env.DB.exec("DROP TRIGGER test_lost_cancellation_claim");
    }
  });

  it("records each reservation release once without changing unrelated pools", async () => {
    const fixture = await paidOrderFixture();
    await env.DB.prepare(
      "INSERT INTO inventory_balance (location_id,inventory_pool_id,on_hand,reserved,version) VALUES ('location-cebu-central','pool-potato',500,0,7) ON CONFLICT(location_id,inventory_pool_id) DO UPDATE SET version=7",
    ).run();
    const request = command(fixture.orderId);
    expect((await cancelOrder(env.DB, request)).ok).toBe(true);
    expect((await cancelOrder(env.DB, request)).ok).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count, SUM(reservation_delta_base) delta FROM inventory_ledger_entries WHERE reference_type='grocery_order' AND reference_id=? AND reason_code='ORDER_CANCELLATION'",
      )
        .bind(fixture.orderId)
        .first(),
    ).toEqual({ count: 1, delta: -1000 });
    expect(
      await env.DB.prepare(
        "SELECT version FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-potato'",
      ).first(),
    ).toEqual({ version: 7 });
  });

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
    ["INSTANT", "OUT_FOR_DELIVERY", "FINANCIAL_OPERATION_REQUIRES_REVIEW"],
    ["SCHEDULED", "DELIVERED", "ILLEGAL_TRANSITION"],
    ["SCHEDULED", "CANCELED", "ILLEGAL_TRANSITION"],
    ["SCHEDULED", "EXPIRED", "ILLEGAL_TRANSITION"],
  ])(
    "rejects %s cancellation from the terminal or late lifecycle state %s",
    async (mode, status, expectedCode) => {
      const fixture = await paidOrderFixture();
      await env.DB.prepare(
        "UPDATE grocery_order SET status=?,fulfillment_mode=?,cycle_id=CASE WHEN ?='INSTANT' THEN NULL ELSE cycle_id END WHERE id=?",
      )
        .bind(status, mode, mode, fixture.orderId)
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

describe("cancellation of remaining paid balances", () => {
  async function priorRefund(intentId: string, amountMinor: number) {
    const provider = createMockPaymentProvider(),
      registry = new ProviderRegistry("test", [provider]);
    const reference = `prior-payment-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "UPDATE payment_attempt SET provider='mock',provider_reference=? WHERE payment_intent_id=?",
    )
      .bind(reference, intentId)
      .run();
    const key = crypto.randomUUID();
    const requested = await requestRefund(env.DB, registry, {
      paymentIntentId: intentId,
      amountMinor,
      reason: "Prior inspected adjustment",
      idempotencyKey: key,
      actorId: "system:test",
      requestId: crypto.randomUUID(),
    });
    if (!requested.ok) throw new Error("Prior Refund fixture rejected");
    const stored = await env.DB.prepare(
      "SELECT provider_refund_reference FROM payment_refund WHERE id=?",
    )
      .bind(requested.value.refundId)
      .first<{ provider_refund_reference: string }>();
    if (!stored) throw new Error("Missing prior Refund reference");
    setMockRefundObservation(provider, key, {
      outcome: "FOUND",
      refund: {
        providerReference: reference,
        providerRefundReference: stored.provider_refund_reference,
        idempotencyKey: key,
        canonicalState: "SUCCEEDED",
        amountMinor,
        currency: "PHP",
        observedAt: Date.now(),
      },
    });
    // Refund submission/lookup are real commands; paid Order/addition linkage is the existing fixture boundary.
    for (let batch = 0; batch < 8; batch++)
      await reconcileRefunds(env.DB, registry, Date.now() + 61000);
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
        .bind(requested.value.refundId)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    return requested.value.refundId;
  }
  it("refunds the exact remaining original and addition balances while preserving prior successes", async () => {
    const f = await paidOrderFixture();
    const amendment = await addCommittedAmendment(f, 6000);
    const first = await priorRefund(f.intentId, 4000);
    const second = await priorRefund(amendment, 1000);
    const set = await buildCancellationRefundSet(env.DB, f.orderId, 0);
    expect(set).toMatchObject({
      grossPaidMinor: 30000,
      previouslyRefundedMinor: 5000,
      remainingPaidMinor: 25000,
    });
    const provider = createMockPaymentProvider(),
      registry = new ProviderRegistry("test", [provider]);
    const result = await cancelOrder(env.DB, command(f.orderId), {
      requestRefund: async (input) => {
        const refund = await requestRefund(env.DB, registry, {
          ...input,
          actorId: "system:test",
          requestId: crypto.randomUUID(),
        });
        return refund.ok
          ? { ok: true, refundId: refund.value.refundId, refundState: refund.value.state }
          : { ok: false };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        requiredRefundMinor: 25000,
        refunds: expect.arrayContaining([
          expect.objectContaining({ paymentId: f.intentId, amountMinor: 20000 }),
          expect.objectContaining({ paymentId: amendment, amountMinor: 5000 }),
        ]),
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM payment_refund WHERE id IN (?,?) AND status='SUCCEEDED'",
      )
        .bind(first, second)
        .first(),
    ).toEqual({ n: 2 });
    if (!result.ok || !result.value.cancellationId) throw new Error("Cancellation rejected");
    const pending = await env.DB.prepare(
      "SELECT r.id,r.idempotency_key,r.provider_refund_reference,r.amount_minor,a.provider_reference FROM payment_refund r JOIN payment_attempt a ON a.payment_intent_id=r.payment_intent_id JOIN order_cancellation_refund_member m ON m.refund_id=r.id WHERE m.cancellation_id=?",
    )
      .bind(result.value.cancellationId)
      .all<{
        id: string;
        idempotency_key: string;
        provider_refund_reference: string;
        amount_minor: number;
        provider_reference: string;
      }>();
    expect(pending.results).toHaveLength(2);
    for (const refund of pending.results)
      setMockRefundObservation(provider, refund.idempotency_key, {
        outcome: "FOUND",
        refund: {
          providerReference: refund.provider_reference,
          providerRefundReference: refund.provider_refund_reference,
          idempotencyKey: refund.idempotency_key,
          canonicalState: "SUCCEEDED",
          amountMinor: refund.amount_minor,
          currency: "PHP",
          observedAt: Date.now(),
        },
      });
    for (let batch = 0; batch < 8; batch++)
      await reconcileRefunds(env.DB, registry, Date.now() + 61000);
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(f.orderId).first(),
    ).toEqual({ status: "CANCELED" });
    expect(
      await env.DB.prepare(
        "SELECT SUM(amount_minor) total FROM payment_refund WHERE payment_intent_id IN (?,?) AND status='SUCCEEDED'",
      )
        .bind(f.intentId, amendment)
        .first(),
    ).toEqual({ total: 30000 });
  });
  it("includes a fully refunded original in the guarded paid set while refunding its remaining addition", async () => {
    const f = await paidOrderFixture();
    const amendment = await addCommittedAmendment(f, 6000);
    await priorRefund(f.intentId, 24000);
    const result = await cancelOrder(env.DB, command(f.orderId));
    expect(result).toMatchObject({
      ok: true,
      value: {
        requiredRefundMinor: 6000,
        refunds: [expect.objectContaining({ paymentId: amendment, amountMinor: 6000 })],
      },
    });
  });
  it("atomically completes a fully refunded cancellation without creating another Refund", async () => {
    const f = await paidOrderFixture();
    await priorRefund(f.intentId, 24000);
    const decision = command(f.orderId);
    const result = await cancelOrder(env.DB, decision);
    expect(result).toMatchObject({
      ok: true,
      value: { status: "COMPLETED", requiredRefundMinor: 0, refunds: [] },
    });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(f.orderId).first(),
    ).toEqual({ status: "CANCELED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_refund WHERE payment_intent_id=?")
        .bind(f.intentId)
        .first(),
    ).toEqual({ n: 1 });
    expect(await cancelOrder(env.DB, decision)).toEqual(result);
  });
  it("rolls back zero-refund admission and operational release when completion evidence is ignored", async () => {
    const f = await paidOrderFixture();
    await priorRefund(f.intentId, 24000);
    const decision = command(f.orderId);
    await env.DB.exec(
      "CREATE TRIGGER ignore_zero_completion BEFORE INSERT ON audit_event WHEN NEW.action='ORDER.CANCELLATION_COMPLETED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await cancelOrder(env.DB, decision)).toMatchObject({ ok: false });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_zero_completion");
    }
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(f.orderId).first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM order_cancellation WHERE order_id=?")
        .bind(f.orderId)
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare("SELECT status FROM inventory_reservation WHERE order_id=?")
        .bind(f.orderId)
        .first(),
    ).toEqual({ status: "RESERVED" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM idempotency_records WHERE scope='orders.cancel' AND idempotency_key=?",
      )
        .bind(decision.idempotencyKey)
        .first(),
    ).toEqual({ n: 0 });
  });
  it("recovers a retained accepted zero-refund cancellation through the registered job", async () => {
    const f = await paidOrderFixture();
    await priorRefund(f.intentId, 24000);
    const id = crypto.randomUUID(),
      now = Date.now();
    // Explicit pre-repair persisted acceptance seam; the new command no longer creates this split state.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE inventory_balance SET reserved=reserved-1000,version=version+1 WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
      ),
      env.DB.prepare(
        "UPDATE inventory_reservation SET status='RELEASED' WHERE order_id=? AND status='RESERVED'",
      ).bind(f.orderId),
      env.DB.prepare(
        "UPDATE grocery_order SET status='CANCELLATION_REQUESTED',version=version+1 WHERE id=?",
      ).bind(f.orderId),
      env.DB.prepare(
        "INSERT INTO order_cancellation(id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,required_refund_minor,currency,version,created_at,updated_at) VALUES (?,?,'CUSTOMER','CUSTOMER_REQUEST','Already refunded','REQUESTED',0,0,'PHP',1,?,?)",
      ).bind(id, f.orderId, now, now),
    ]);
    const job = getJobsForCron("* * * * *").find(
      (job) => job.name === "orders.cancellation-refunds",
    );
    if (!job) throw new Error("Missing registered cancellation recovery job");
    await job.run({
      database: env.DB,
      registry: new ProviderRegistry("test", []),
      emailDelivery: {
        send: async () => ({ ok: false, code: "TEST_DISABLED", outcome: "NOT_SENT" }),
      },
      now,
    });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(f.orderId).first(),
    ).toEqual({ status: "CANCELED" });
    expect(
      await env.DB.prepare("SELECT status FROM order_cancellation WHERE id=?").bind(id).first(),
    ).toEqual({ status: "COMPLETED" });
  });
  it("rejects a competing prior refund after reading the remaining balance", async () => {
    const f = await paidOrderFixture();
    await priorRefund(f.intentId, 4000);
    const decision = command(f.orderId);
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare(
                "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?, ?, 500,'PHP','PROCESSING','Concurrent request',?,1,?,?)",
              )
              .bind(crypto.randomUUID(), f.intentId, crypto.randomUUID(), Date.now(), Date.now())
              .run();
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await cancelOrder(database, decision)).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(f.orderId).first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM order_cancellation WHERE order_id=?")
        .bind(f.orderId)
        .first(),
    ).toEqual({ n: 0 });
  });
});
