import { requestHash } from "../../idempotency";
import { requestStaffRefund } from "./request-staff-refund";
import { locationManager } from "../../test-location-fixtures";
import { describe, expect, it, vi } from "vitest";
import { cancelOrder } from "../../orders/application/cancel-order";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { ingestProviderEvent } from "./ingest-provider-event";
import { requestRefund, type RequestRefundCommand } from "./request-refund";
import {
  createMockPaymentProvider,
  mockSignatureFor,
  setMockRefundFailure,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { extendPaymentRepositoryForRefunds } from "../infrastructure/d1/payment-repository";

const sharedMock = createMockPaymentProvider();
function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [sharedMock]);
}
function mock() {
  return sharedMock;
}

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-ref-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function succeededIntent() {
  const created = await createPayment(env.DB, testRegistry(), {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: `ca-${crypto.randomUUID()}`,
    customerId: await seedCustomer(),
    amountMinor: 20000,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: `ref-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  // Drive the intent to SUCCEEDED through verified events only.
  for (const vendorState of ["pending", "paid"]) {
    const rawBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      reference: attempt!.provider_reference,
      vendorState,
      amountMinor: 20000,
      currency: "PHP",
    });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(rawBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      rawBody,
    );
  }
  return { intentId: created.value.paymentIntentId, reference: attempt!.provider_reference };
}

function refundCommand(
  intentId: string,
  overrides: Partial<RequestRefundCommand> = {},
): RequestRefundCommand {
  return {
    paymentIntentId: intentId,
    amountMinor: 5000,
    reason: "customer-requested",
    idempotencyKey: `refund-${crypto.randomUUID()}`,
    actorId: "ops-1",
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("non-synthetic refunds", () => {
  it("does not resubmit a surviving REQUESTED refund identity", async () => {
    const { intentId } = await succeededIntent(),
      request = refundCommand(intentId),
      id = crypto.randomUUID(),
      now = Date.now();
    await env.DB.prepare(
      "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?,?,5000,'PHP','REQUESTED',?,?,1,?,?)",
    )
      .bind(id, intentId, request.reason, request.idempotencyKey, now, now)
      .run();
    const submit = vi.spyOn(sharedMock, "requestRefund");
    try {
      expect(await requestRefund(env.DB, testRegistry(), request)).toMatchObject({
        ok: true,
        value: { refundId: id, state: "REQUESTED" },
      });
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });

  it("replays verified refund ingress after a lost cancellation projection without premature inbox completion", async () => {
    const { intentId } = await succeededIntent();
    const orderId = crypto.randomUUID(),
      now = Date.now();
    // Paid Order linkage is the fixture boundary; payment, cancellation and refund commands are real.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at)
        SELECT ?,customer_id,'cycle-next-cebu','SCHEDULED','{}','COMMITTED',amount_minor,currency,id,? FROM payment_attempt WHERE payment_intent_id=?`).bind(
        orderId,
        now,
        intentId,
      ),
      env.DB.prepare(`INSERT INTO order_fulfillment_snapshot(order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,fulfillment_mode,sourcing_modes_json,created_at)
        VALUES (?,'location-cebu-central','cycle-next-cebu','zone-cebu-city-core',?,?,'SCHEDULED','[]',?)`).bind(
        orderId,
        now + 86400000,
        now + 172800000,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), intentId, crypto.randomUUID(), orderId, now),
    ]);
    const cancellation = await cancelOrder(
      env.DB,
      {
        orderId,
        expectedVersion: 1,
        reason: "Customer request",
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
      },
      {
        requestRefund: async (input) => {
          const result = await requestRefund(env.DB, testRegistry(), {
            ...input,
            actorId: "test-operator",
            requestId: crypto.randomUUID(),
          });
          if (!result.ok) throw new Error(result.error.message);
          return { ok: true, refundId: result.value.refundId, refundState: result.value.state };
        },
      },
    );
    expect(cancellation.ok).toBe(true);
    const refund = await env.DB.prepare(
      "SELECT id,provider_refund_reference FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ id: string; provider_refund_reference: string }>();
    if (!refund) throw new Error("Refund missing");
    const eventId = crypto.randomUUID(),
      body = JSON.stringify({
        eventId,
        kind: "refund",
        refundReference: refund.provider_refund_reference,
        vendorState: "paid",
        amountMinor: 20000,
        currency: "PHP",
      });
    const send = async () =>
      ingestProviderEvent(
        env.DB,
        testRegistry(),
        "mock",
        new Headers({
          "x-mock-signature": await mockSignatureFor(body),
          "x-mock-timestamp": String(Date.now()),
        }),
        body,
      );
    await env.DB.exec(
      "CREATE TRIGGER test_refund_projection_loss BEFORE UPDATE OF status ON grocery_order WHEN NEW.status='CANCELED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      await expect(send()).rejects.toThrow();
      expect(
        await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
          .bind(refund.id)
          .first(),
      ).toEqual({ status: "SUCCEEDED" });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM payment_provider_event_inbox WHERE provider_event_id=?",
        )
          .bind(eventId)
          .first(),
      ).toEqual({ processing_status: "RECEIVED" });
      // Retry now sees an already-SUCCEEDED Refund; failure must still leave its inbox retryable.
      vi.spyOn(Date, "now").mockReturnValue(now + 60000);
      await expect(send()).rejects.toThrow();
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM payment_provider_event_inbox WHERE provider_event_id=?",
        )
          .bind(eventId)
          .first(),
      ).toEqual({ processing_status: "RECEIVED" });
    } finally {
      await env.DB.exec("DROP TRIGGER test_refund_projection_loss");
      vi.restoreAllMocks();
    }
    vi.spyOn(Date, "now").mockReturnValue(now + 120000);
    try {
      expect(await send()).toMatchObject({ ok: true, value: { processingStatus: "DUPLICATE" } });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
      ).toEqual({ status: "CANCELED" });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM payment_provider_event_inbox WHERE provider_event_id=?",
        )
          .bind(eventId)
          .first(),
      ).toEqual({ processing_status: "APPLIED" });
      expect(await send()).toMatchObject({ ok: true, value: { processingStatus: "DUPLICATE" } });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM payment_refund WHERE payment_intent_id=?")
          .bind(intentId)
          .first(),
      ).toEqual({ count: 1 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not persist settlement evidence when the refund compare-and-swap loses", async () => {
    const { intentId } = await succeededIntent();
    const created = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const repository = extendPaymentRepositoryForRefunds(env.DB);
    const changed = await repository.updateRefundStatusCas({
      refundId: created.value.refundId,
      paymentIntentId: intentId,
      expectedVersion: 999,
      fromStatus: "PROCESSING",
      toStatus: "SUCCEEDED",
      now: Date.now(),
      settlementObservation: {
        provider: "mock",
        providerEventId: `evt-${crypto.randomUUID()}`,
        paymentIntentId: intentId,
        settlement: {
          grossMinor: 5_000,
          processingCostMinor: 100,
          withholdingMinor: 0,
          adjustmentMinor: 0,
          netMinor: 4_900,
          currency: "PHP",
          observedAt: Date.now(),
        },
        now: Date.now(),
      },
    });
    expect(changed).toBe(0);
    const settlementCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_settlement_observation WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(settlementCount?.count).toBe(0);
  });

  it("reserves outstanding ESCALATED refund value", async () => {
    const { intentId } = await succeededIntent();
    await env.DB.prepare(
      "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, 16000, 'PHP', 'ESCALATED', 'ambiguous', ?, 1, ?, ?)",
    )
      .bind(crypto.randomUUID(), intentId, `seed-${crypto.randomUUID()}`, Date.now(), Date.now())
      .run();

    const result = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { amountMinor: 5000 }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REFUND_AMOUNT_UNAVAILABLE" },
    });
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it("allows only one concurrent full-refund budget claim", async () => {
    const { intentId } = await succeededIntent();

    const [first, second] = await Promise.all([
      requestRefund(
        env.DB,
        testRegistry(),
        refundCommand(intentId, {
          amountMinor: 20000,
          idempotencyKey: `full-a-${crypto.randomUUID()}`,
        }),
      ),
      requestRefund(
        env.DB,
        testRegistry(),
        refundCommand(intentId, {
          amountMinor: 20000,
          idempotencyKey: `full-b-${crypto.randomUUID()}`,
        }),
      ),
    ]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { code: "REFUND_AMOUNT_UNAVAILABLE" },
    });
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it("creates a processing refund without ever writing SUCCEEDED locally", async () => {
    const { intentId } = await succeededIntent();
    const result = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
    expect(result).toMatchObject({ ok: true, value: { state: "PROCESSING" } });
    if (!result.ok) return;
    const row = await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
      .bind(result.value.refundId)
      .first<{ status: string }>();
    expect(row?.status).toBe("PROCESSING");
    expect(row?.status).not.toBe("SUCCEEDED");
  });

  it("does not reserve refundable value when no provider attempt is available", async () => {
    const { intentId } = await succeededIntent();
    await env.DB.prepare("DELETE FROM payment_attempt WHERE payment_intent_id=?")
      .bind(intentId)
      .run();

    const result = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));

    expect(result).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("does not reserve refundable value when the captured provider is disabled", async () => {
    const { intentId } = await succeededIntent();
    await env.DB.prepare("UPDATE payment_attempt SET provider='disabled' WHERE payment_intent_id=?")
      .bind(intentId)
      .run();

    const result = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNCONFIGURED" },
    });
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("escalates a replayed REQUESTED refund when its provider seam is unavailable", async () => {
    const { intentId } = await succeededIntent();
    const idempotencyKey = `orphan-${crypto.randomUUID()}`;
    const refundId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, 5000, 'PHP', 'REQUESTED', 'orphaned', ?, 1, ?, ?)",
    )
      .bind(refundId, intentId, idempotencyKey, Date.now(), Date.now())
      .run();
    await env.DB.prepare("DELETE FROM payment_attempt WHERE payment_intent_id=?")
      .bind(intentId)
      .run();

    const result = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { idempotencyKey }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const row = await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
      .bind(refundId)
      .first<{ status: string }>();
    expect(row?.status).toBe("ESCALATED");
    const reconciliation = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REFUND_UNRESOLVED'",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(reconciliation?.count).toBe(1);
  });

  it("rejects refunds above the captured amount and illegal intent states", async () => {
    const { intentId } = await succeededIntent();
    const over = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { amountMinor: 999999 }),
    );
    expect(over).toMatchObject({
      ok: false,
      error: { code: "REFUND_AMOUNT_UNAVAILABLE" },
    });

    const pendingIntent = await createPayment(env.DB, testRegistry(), {
      purpose: "MEMBERSHIP_RENEWAL",
      subjectType: "subscription",
      subjectId: `sub-${crypto.randomUUID()}`,
      customerId: await seedCustomer(),
      amountMinor: 29900,
      currency: "PHP",
      providerCode: "mock",
      returnUrl: "https://app.example/r",
      idempotencyKey: `ref-pending-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(pendingIntent.ok).toBe(true);
    if (!pendingIntent.ok) return;
    const illegal = await requestRefund(env.DB, testRegistry(), {
      ...refundCommand(pendingIntent.value.paymentIntentId),
      amountMinor: 100,
    });
    expect(illegal).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });

  it("replays duplicate refund requests stably and rejects key reuse with a different payload", async () => {
    const { intentId } = await succeededIntent();
    const attempt = refundCommand(intentId);
    const first = await requestRefund(env.DB, testRegistry(), attempt);
    expect(first.ok).toBe(true);
    const replay = await requestRefund(env.DB, testRegistry(), attempt);
    expect(replay).toEqual(first);
    const conflict = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { idempotencyKey: attempt.idempotencyKey, amountMinor: 100 }),
    );
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("records a definitive provider rejection as REJECTED, never SUCCEEDED", async () => {
    const { intentId, reference } = await succeededIntent();
    setMockRefundFailure(mock(), reference);
    const result = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
    expect(result).toMatchObject({ ok: false, error: { code: "PAYMENT_FAILED" } });
    const row = await env.DB.prepare("SELECT status FROM payment_refund WHERE payment_intent_id=?")
      .bind(intentId)
      .first<{ status: string }>();
    expect(row?.status).toBe("REJECTED");
  });

  it("completes a refund to SUCCEEDED only through a verified provider event", async () => {
    const { intentId } = await succeededIntent();
    const created = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
    expect(created).toMatchObject({ ok: true, value: { state: "PROCESSING" } });
    if (!created.ok) return;
    const stored = await env.DB.prepare(
      "SELECT provider_refund_reference FROM payment_refund WHERE id=?",
    )
      .bind(created.value.refundId)
      .first<{ provider_refund_reference: string }>();

    const providerEventId = `evt-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify({
      eventId: providerEventId,
      kind: "refund",
      refundReference: stored!.provider_refund_reference,
      vendorState: "paid",
      amountMinor: 5000,
      currency: "PHP",
      settlement: {
        grossMinor: 5_000,
        processingCostMinor: 100,
        withholdingMinor: 0,
        adjustmentMinor: 0,
        netMinor: 4_900,
      },
    });
    const outcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(rawBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      rawBody,
    );
    expect(outcome).toMatchObject({ ok: true, value: { processingStatus: "APPLIED" } });

    const refundRow = await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
      .bind(created.value.refundId)
      .first<{ status: string }>();
    expect(refundRow?.status).toBe("SUCCEEDED");
    const intentRow = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(intentId)
      .first<{ status: string }>();
    expect(intentRow?.status).toBe("PARTIALLY_REFUNDED");
    const settlement = await env.DB.prepare(
      "SELECT payment_intent_id, gross_minor, processing_cost_minor, net_minor FROM payment_settlement_observation WHERE provider='mock' AND provider_event_id=?",
    )
      .bind(providerEventId)
      .first<{
        payment_intent_id: string;
        gross_minor: number;
        processing_cost_minor: number;
        net_minor: number;
      }>();
    expect(settlement).toEqual({
      payment_intent_id: intentId,
      gross_minor: 5_000,
      processing_cost_minor: 100,
      net_minor: 4_900,
    });

    const replayEventId = `evt-${crypto.randomUUID()}`;
    const replayBody = rawBody.replace(providerEventId, replayEventId);
    const replay = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(replayBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      replayBody,
    );
    expect(replay).toMatchObject({ ok: true, value: { processingStatus: "DUPLICATE" } });
    const settlementCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_settlement_observation WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(settlementCount?.count).toBe(2);
  });

  it("advances a partially refunded payment to REFUNDED after the remaining refund succeeds", async () => {
    const { intentId } = await succeededIntent();
    const first = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { amountMinor: 12_000 }),
    );
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const firstStored = await env.DB.prepare(
      "SELECT provider_refund_reference FROM payment_refund WHERE id=?",
    )
      .bind(first.value.refundId)
      .first<{ provider_refund_reference: string }>();
    const firstBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      kind: "refund",
      refundReference: firstStored!.provider_refund_reference,
      vendorState: "paid",
      amountMinor: 12_000,
      currency: "PHP",
    });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(firstBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      firstBody,
    );

    const second = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { amountMinor: 8_000 }),
    );
    if (!second.ok) throw new Error(JSON.stringify(second.error));
    const secondStored = await env.DB.prepare(
      "SELECT provider_refund_reference FROM payment_refund WHERE id=?",
    )
      .bind(second.value.refundId)
      .first<{ provider_refund_reference: string }>();
    const secondBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      kind: "refund",
      refundReference: secondStored!.provider_refund_reference,
      vendorState: "paid",
      amountMinor: 8_000,
      currency: "PHP",
    });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(secondBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      secondBody,
    );

    const intent = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(intentId)
      .first<{ status: string }>();
    expect(intent?.status).toBe("REFUNDED");
  });
});

async function staffRefundFixture() {
  const { intentId } = await succeededIntent();
  const manager = await locationManager("global");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='refunds.manage'",
  )
    .bind(manager.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ auth_user_id: string }>();
  const payment = await env.DB.prepare("SELECT version FROM payment_intent WHERE id=?")
    .bind(intentId)
    .first<{ version: number }>();
  if (!actor || !payment) throw new Error("Missing staff/payment fixture");
  return {
    manager,
    command: {
      paymentIntentId: intentId,
      amountMinor: 5000,
      reason: "Inspected quality issue",
      expectedVersion: payment.version,
      actorAuthUserId: actor.auth_user_id,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    },
  };
}

describe("staff refund admission and external execution", () => {
  it("submits a verified captured payment once and preserves acceptance after progress", async () => {
    const { command } = await staffRefundFixture();
    const provider = createMockPaymentProvider();
    const submit = vi.spyOn(provider, "requestRefund");
    const registry = new ProviderRegistry("test", [provider]);
    const first = await requestStaffRefund(env.DB, registry, command);
    expect(first).toMatchObject({ ok: true, value: { status: "REQUESTED", amountMinor: 5000 } });
    const stored = await env.DB.prepare(
      "SELECT status,provider_refund_reference FROM payment_refund WHERE idempotency_key=?",
    )
      .bind(command.idempotencyKey)
      .first<{ status: string; provider_refund_reference: string }>();
    expect(stored?.status).toBe("PROCESSING");
    const rawBody = JSON.stringify({
      eventId: crypto.randomUUID(),
      kind: "refund",
      refundReference: stored?.provider_refund_reference,
      vendorState: "paid",
      amountMinor: 5000,
      currency: "PHP",
    });
    await ingestProviderEvent(
      env.DB,
      registry,
      "mock",
      new Headers({
        "x-mock-signature": await mockSignatureFor(rawBody),
        "x-mock-timestamp": String(Date.now()),
      }),
      rawBody,
    );
    expect(await requestStaffRefund(env.DB, registry, command)).toEqual(first);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      await requestStaffRefund(env.DB, registry, { ...command, reason: "Changed reason" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await requestStaffRefund(env.DB, registry, {
        ...command,
        expectedVersion: command.expectedVersion + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("retains unknown provider outcomes without repeating submission", async () => {
    const { command } = await staffRefundFixture();
    const provider = createMockPaymentProvider();
    const submit = vi
      .spyOn(provider, "requestRefund")
      .mockRejectedValue(new Error("TEST_UNKNOWN_OUTCOME"));
    const registry = new ProviderRegistry("test", [provider]);
    const first = await requestStaffRefund(env.DB, registry, command);
    expect(first).toMatchObject({ ok: true, value: { status: "REQUESTED" } });
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE idempotency_key=?")
        .bind(command.idempotencyKey)
        .first(),
    ).toEqual({ status: "ESCALATED" });
    expect(await requestStaffRefund(env.DB, registry, command)).toEqual(first);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REFUND_UNRESOLVED'",
      )
        .bind(command.paymentIntentId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it.each(["PROCESSING", "SUCCEEDED"] as const)(
    "handles retained %s keys without repeating historical effects",
    async (status) => {
      const { command } = await staffRefundFixture();
      const hash = await requestHash({
        paymentIntentId: command.paymentIntentId,
        amountMinor: command.amountMinor,
        reason: command.reason,
      });
      await env.DB.prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at) VALUES ('admin.payments.refund',?,?,?,'payment_refund',?, ?,?)",
      )
        .bind(
          command.idempotencyKey,
          hash,
          status,
          status === "SUCCEEDED" ? "historical-refund" : null,
          Date.now(),
          Date.now(),
        )
        .run();
      const provider = createMockPaymentProvider();
      const submit = vi.spyOn(provider, "requestRefund");
      const registry = new ProviderRegistry("test", [provider]);
      const result = await requestStaffRefund(env.DB, registry, command);
      if (status === "SUCCEEDED") {
        expect(result).toMatchObject({
          ok: false,
          error: { code: "CONFLICT", message: expect.stringContaining("already recorded") },
        });
        expect(submit).not.toHaveBeenCalled();
      } else {
        expect(result).toMatchObject({ ok: true, value: { status: "REQUESTED" } });
        expect(await requestStaffRefund(env.DB, registry, command)).toEqual(result);
        expect(submit).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(["scope", "permission", "staff", "payment", "provider", "budget", "late-audit"] as const)(
    "rejects a transaction-time %s change without partial admission",
    async (kind) => {
      const { manager, command } = await staffRefundFixture();
      const provider = createMockPaymentProvider();
      const submit = vi.spyOn(provider, "requestRefund");
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
              if (kind === "payment")
                await target
                  .prepare("UPDATE payment_intent SET version=version+1 WHERE id=?")
                  .bind(command.paymentIntentId)
                  .run();
              if (kind === "provider")
                await target
                  .prepare(
                    "UPDATE payment_attempt SET provider_reference='changed' WHERE payment_intent_id=?",
                  )
                  .bind(command.paymentIntentId)
                  .run();
              if (kind === "budget")
                await target
                  .prepare(
                    "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,version,created_at,updated_at) VALUES (?,?,20000,'PHP','ESCALATED','Competing unknown refund',?,1,?,?)",
                  )
                  .bind(
                    crypto.randomUUID(),
                    command.paymentIntentId,
                    crypto.randomUUID(),
                    Date.now(),
                    Date.now(),
                  )
                  .run();
              return target.batch(
                kind === "late-audit"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-40)")]
                  : statements,
              );
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await requestStaffRefund(database, new ProviderRegistry("test", [provider]), command),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(reached).toBe(true);
      expect(submit).not.toHaveBeenCalled();
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM payment_refund WHERE idempotency_key=?")
          .bind(command.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE scope='admin.payments.refund' AND idempotency_key=?",
        )
          .bind(command.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
          .bind(command.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
});

async function observableRefund() {
  const { intentId } = await succeededIntent();
  const created = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
  if (!created.ok) throw new Error("Refund fixture failed");
  const row = await env.DB.prepare(
    "SELECT provider_refund_reference FROM payment_refund WHERE id=?",
  )
    .bind(created.value.refundId)
    .first<{ provider_refund_reference: string }>();
  if (!row) throw new Error("Refund reference missing");
  function body(state = "paid", eventId = crypto.randomUUID()) {
    return JSON.stringify({
      eventId,
      kind: "refund",
      refundReference: row!.provider_refund_reference,
      vendorState: state,
      amountMinor: 5000,
      currency: "PHP",
      settlement:
        state === "paid"
          ? {
              grossMinor: 5000,
              processingCostMinor: 0,
              withholdingMinor: 0,
              adjustmentMinor: 0,
              netMinor: 5000,
            }
          : undefined,
    });
  }
  async function send(raw = body(), registry = testRegistry(), code = "mock") {
    return ingestProviderEvent(
      env.DB,
      registry,
      code,
      new Headers({
        "x-mock-signature": await mockSignatureFor(raw),
        "x-mock-timestamp": String(Date.now()),
      }),
      raw,
    );
  }
  return {
    intentId,
    refundId: created.value.refundId,
    reference: row.provider_refund_reference,
    body,
    send,
  };
}

describe("refund observation recovery and terminal evidence", () => {
  it("keeps successful money immutable under delayed pending and conflicting failure", async () => {
    const fixture = await observableRefund();
    expect(await fixture.send()).toMatchObject({
      ok: true,
      value: { processingStatus: "APPLIED" },
    });
    const before = await env.DB.prepare("SELECT status,version FROM payment_refund WHERE id=?")
      .bind(fixture.refundId)
      .first();
    expect(await fixture.send(fixture.body("pending"))).toMatchObject({
      ok: true,
      value: { processingStatus: "DUPLICATE", canonicalState: "SUCCEEDED" },
    });
    expect(await fixture.send(fixture.body("failed"))).toMatchObject({
      ok: true,
      value: { processingStatus: "RECONCILIATION_REQUIRED", canonicalState: "SUCCEEDED" },
    });
    expect(
      await env.DB.prepare("SELECT status,version FROM payment_refund WHERE id=?")
        .bind(fixture.refundId)
        .first(),
    ).toEqual(before);
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ status: "PARTIALLY_REFUNDED" });
  });

  it("rejects a refund identity observed by a different verified provider", async () => {
    const fixture = await observableRefund();
    const delegate = createMockPaymentProvider();
    const other = {
      ...delegate,
      code: "other",
      async verifyAndParseEvent(headers: Headers, raw: string) {
        const result = await delegate.verifyAndParseEvent(headers, raw);
        return result.ok ? { ...result, event: { ...result.event, provider: "other" } } : result;
      },
    };
    expect(
      await fixture.send(fixture.body(), new ProviderRegistry("test", [other]), "other"),
    ).toMatchObject({ ok: true, value: { processingStatus: "RECONCILIATION_REQUIRED" } });
    expect(
      await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
        .bind(fixture.refundId)
        .first(),
    ).toEqual({ status: "PROCESSING" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM payment_settlement_observation WHERE payment_intent_id=?",
      )
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("does not pick one of two refunds sharing a provider reference", async () => {
    const fixture = await observableRefund();
    await env.DB.prepare(
      "INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,reason,idempotency_key,provider_refund_reference,version,created_at,updated_at) VALUES (?,?,5000,'PHP','PROCESSING','Retained ambiguous mapping',?,?,1,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        fixture.intentId,
        crypto.randomUUID(),
        fixture.reference,
        Date.now(),
        Date.now(),
      )
      .run();
    expect(await fixture.send()).toMatchObject({
      ok: true,
      value: { processingStatus: "RECONCILIATION_REQUIRED" },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM payment_refund WHERE payment_intent_id=? AND status='SUCCEEDED'",
      )
        .bind(fixture.intentId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it.each(["payment-projection", "settlement"] as const)(
    "recovers an ignored %s without premature application",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fixture = await observableRefund();
      const trigger =
        kind === "payment-projection"
          ? `CREATE TRIGGER test_ignored_financial_effect BEFORE UPDATE OF status ON payment_intent WHEN NEW.id='${fixture.intentId}' AND NEW.status='PARTIALLY_REFUNDED' BEGIN SELECT RAISE(IGNORE); END`
          : `CREATE TRIGGER test_ignored_financial_effect BEFORE INSERT ON payment_settlement_observation WHEN NEW.payment_intent_id='${fixture.intentId}' BEGIN SELECT RAISE(IGNORE); END`;
      await env.DB.prepare(trigger).run();
      try {
        const raw = fixture.body();
        expect(await fixture.send(raw)).toMatchObject({
          ok: true,
          value: { processingStatus: "RETRY_REQUIRED" },
        });
        expect(
          await env.DB.prepare("SELECT status FROM payment_refund WHERE id=?")
            .bind(fixture.refundId)
            .first(),
        ).toEqual({ status: "PROCESSING" });
        expect(
          await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
            .bind(fixture.intentId)
            .first(),
        ).toEqual({ status: "SUCCEEDED" });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM payment_settlement_observation WHERE payment_intent_id=?",
          )
            .bind(fixture.intentId)
            .first(),
        ).toEqual({ count: 0 });
        await env.DB.prepare("DROP TRIGGER test_ignored_financial_effect").run();
        vi.setSystemTime(Date.now() + 31_000);
        expect(await fixture.send(raw)).toMatchObject({
          ok: true,
          value: { processingStatus: "APPLIED" },
        });
        expect(
          await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
            .bind(fixture.intentId)
            .first(),
        ).toEqual({ status: "PARTIALLY_REFUNDED" });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM payment_settlement_observation WHERE payment_intent_id=?",
          )
            .bind(fixture.intentId)
            .first(),
        ).toEqual({ count: 1 });
      } finally {
        await env.DB.prepare("DROP TRIGGER IF EXISTS test_ignored_financial_effect").run();
        vi.useRealTimers();
      }
    },
  );

  it("repairs a retained successful Refund projection on a repeated observation", async () => {
    const fixture = await observableRefund();
    await fixture.send();
    await env.DB.prepare(
      "UPDATE payment_intent SET status='SUCCEEDED',version=version+1 WHERE id=?",
    )
      .bind(fixture.intentId)
      .run();
    expect(await fixture.send()).toMatchObject({
      ok: true,
      value: { processingStatus: "DUPLICATE" },
    });
    const after = await env.DB.prepare("SELECT status,version FROM payment_intent WHERE id=?")
      .bind(fixture.intentId)
      .first();
    expect(after).toMatchObject({ status: "PARTIALLY_REFUNDED" });
    await fixture.send();
    expect(
      await env.DB.prepare("SELECT status,version FROM payment_intent WHERE id=?")
        .bind(fixture.intentId)
        .first(),
    ).toEqual(after);
  });
});
