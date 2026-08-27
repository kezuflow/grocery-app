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

  it("rejects refunds above the captured amount and illegal intent states", async () => {
    const { intentId } = await succeededIntent();
    const over = await requestRefund(
      env.DB,
      testRegistry(),
      refundCommand(intentId, { amountMinor: 999999 }),
    );
    expect(over).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

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

    const rawBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      kind: "refund",
      refundReference: stored!.provider_refund_reference,
      vendorState: "paid",
      amountMinor: 5000,
      currency: "PHP",
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
  });
});
