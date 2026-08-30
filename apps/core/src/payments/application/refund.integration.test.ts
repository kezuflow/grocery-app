import { describe, expect, it } from "vitest";
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
  it("does not persist settlement evidence when the refund compare-and-swap loses", async () => {
    const { intentId } = await succeededIntent();
    const created = await requestRefund(env.DB, testRegistry(), refundCommand(intentId));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const repository = extendPaymentRepositoryForRefunds(env.DB);
    const changed = await repository.updateRefundStatusCas({
      refundId: created.value.refundId,
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
