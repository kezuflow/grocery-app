import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ingestProviderEvent } from "./ingest-provider-event";
import { createPayment } from "./create-payment";
import {
  createMockPaymentProvider,
  mockSignatureFor,
} from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createMockPaymentProvider()]);
}

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-ing-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function seededIntent() {
  const customerId = await seedCustomer();
  const created = await createPayment(env.DB, testRegistry(), {
    purpose: "MEMBERSHIP_ENROLLMENT",
    subjectType: "subscription",
    subjectId: `sub-${crypto.randomUUID()}`,
    customerId,
    amountMinor: 29900,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/return",
    idempotencyKey: `ing-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("fixture failed");
  return created.value;
}

async function signedEvent(body: Record<string, unknown>) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: new Headers({
      "x-mock-signature": await mockSignatureFor(rawBody),
      "x-mock-timestamp": String(Date.now()),
    }),
  };
}

function eventFor(reference: string) {
  return {
    eventId: `evt-${crypto.randomUUID()}`,
    reference,
    vendorState: "paid",
    amountMinor: 29900,
    currency: "PHP",
  };
}

async function inboxCount(providerEventId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM payment_provider_event_inbox WHERE provider='mock' AND provider_event_id=?",
  )
    .bind(providerEventId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("provider event ingestion", () => {
  it("rejects invalid signatures before trusting any identifier", async () => {
    const forged = new Headers({
      "x-mock-signature": "nope",
      "x-mock-timestamp": String(Date.now()),
    });
    const outcome = await ingestProviderEvent(env.DB, testRegistry(), "mock", forged, "{}");
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "WEBHOOK_VERIFICATION_FAILED" },
    });
  });

  it("rejects events for unconfigured providers", async () => {
    const signed = await signedEvent(eventFor("mock_pay_none"));
    const outcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "missing",
      signed.headers,
      signed.rawBody,
    );
    expect(outcome).toMatchObject({ ok: false, error: { code: "PAYMENT_PROVIDER_UNCONFIGURED" } });
  });

  it("applies a sufficient outcome exactly once with one pending reaction", async () => {
    const intent = await seededIntent();
    const reference = `mock_pay_${intent.paymentIntentId}`;
    // The mock attempt reference is derived from the idempotency key; recover it.
    const attemptRow = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intent.paymentIntentId)
      .first<{ provider_reference: string }>();
    const providerReference = attemptRow!.provider_reference;
    void reference;

    const processingEvent = { ...eventFor(providerReference), vendorState: "pending" };
    const processingSigned = await signedEvent(processingEvent);
    const processingOutcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      processingSigned.headers,
      processingSigned.rawBody,
    );
    expect(processingOutcome).toMatchObject({
      ok: true,
      value: {
        processingStatus: "APPLIED",
        canonicalState: "PROCESSING",
        paymentIntentId: intent.paymentIntentId,
      },
    });

    const event = eventFor(providerReference);
    const signed = await signedEvent(event);
    const first = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      signed.headers,
      signed.rawBody,
    );
    expect(first).toMatchObject({
      ok: true,
      value: {
        processingStatus: "APPLIED",
        canonicalState: "SUCCEEDED",
        paymentIntentId: intent.paymentIntentId,
      },
    });

    const reactions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reaction WHERE payment_intent_id=? AND status='PENDING' AND reaction_type='ACTIVATE_MEMBERSHIP'",
    )
      .bind(intent.paymentIntentId)
      .first<{ count: number }>();
    expect(reactions?.count).toBe(1);

    const duplicate = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      signed.headers,
      signed.rawBody,
    );
    expect(duplicate).toMatchObject({ ok: true, value: { processingStatus: "DUPLICATE" } });
    expect(await inboxCount(event.eventId)).toBe(1);
    const reactionTotal = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(intent.paymentIntentId)
      .first<{ count: number }>();
    expect(reactionTotal?.count).toBe(1);
  });

  it("flags the same event identity with a different payload as rejected", async () => {
    const intent = await seededIntent();
    const attemptRow = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intent.paymentIntentId)
      .first<{ provider_reference: string }>();
    const event = eventFor(attemptRow!.provider_reference);
    const signed = await signedEvent(event);
    await ingestProviderEvent(env.DB, testRegistry(), "mock", signed.headers, signed.rawBody);

    const tampered = { ...event, vendorState: "failed" };
    const tamperedSigned = await signedEvent(tampered);
    const outcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      tamperedSigned.headers,
      tamperedSigned.rawBody,
    );
    expect(outcome).toMatchObject({ ok: true, value: { processingStatus: "REJECTED" } });
    const cases = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE category='AMBIGUOUS_OUTCOME' AND status='OPEN'",
    ).first<{ count: number }>();
    expect(cases?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("marks retry required when a concurrent command changes the payment version", async () => {
    const intent = await seededIntent();
    const attemptRow = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intent.paymentIntentId)
      .first<{ provider_reference: string }>();
    const reference = attemptRow!.provider_reference;
    // Advance to PROCESSING so a sufficient observation is a legal transition.
    const processingSigned = await signedEvent({ ...eventFor(reference), vendorState: "pending" });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      processingSigned.headers,
      processingSigned.rawBody,
    );

    // Two distinct sufficient observations racing the same stored version:
    // exactly one may win the compare-and-swap; the loser must be retried.
    const eventA = eventFor(reference);
    const eventB = eventFor(reference);
    const [signedA, signedB] = await Promise.all([signedEvent(eventA), signedEvent(eventB)]);
    const outcomes = await Promise.all([
      ingestProviderEvent(env.DB, testRegistry(), "mock", signedA.headers, signedA.rawBody),
      ingestProviderEvent(env.DB, testRegistry(), "mock", signedB.headers, signedB.rawBody),
    ]);
    const statuses = outcomes.map((outcome) =>
      outcome.ok ? outcome.value.processingStatus : `error:${outcome.error.code}`,
    );
    expect(statuses.filter((status) => status === "APPLIED")).toHaveLength(1);
    expect(statuses.filter((status) => status === "RETRY_REQUIRED")).toHaveLength(1);
  });

  it("never accepts an expectedVersion from the payload", async () => {
    const intent = await seededIntent();
    const attemptRow = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intent.paymentIntentId)
      .first<{ provider_reference: string }>();
    const processingSigned = await signedEvent({
      ...eventFor(attemptRow!.provider_reference),
      vendorState: "pending",
      expectedVersion: 999999,
    });
    await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      processingSigned.headers,
      processingSigned.rawBody,
    );

    const paidSigned = await signedEvent({
      ...eventFor(attemptRow!.provider_reference),
      expectedVersion: 999999,
    });
    const outcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      paidSigned.headers,
      paidSigned.rawBody,
    );
    // The client-supplied field is ignored; the observation applies through internal CAS.
    expect(outcome).toMatchObject({ ok: true, value: { processingStatus: "APPLIED" } });
  });

  it("leaves non-membership reactions to the redrive owner on success", async () => {
    const customerId = await seedCustomer();
    const created = await createPayment(env.DB, testRegistry(), {
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_quote",
      subjectId: `quote-${crypto.randomUUID()}`,
      customerId,
      amountMinor: 15000,
      currency: "PHP",
      providerCode: "mock",
      returnUrl: "https://app.example/return",
      idempotencyKey: `ing-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("fixture failed");
    const attemptRow = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(created.value.paymentIntentId)
      .first<{ provider_reference: string }>();
    const paid = await signedEvent(eventFor(attemptRow!.provider_reference));
    const outcome = await ingestProviderEvent(
      env.DB,
      testRegistry(),
      "mock",
      paid.headers,
      paid.rawBody,
    );
    expect(outcome).toMatchObject({ ok: true, value: { processingStatus: "APPLIED" } });
    // The COMMIT_ORDER reaction stays pending for its owning applier; the
    // membership reaction applier is never invoked for checkout subjects.
    const reaction = await env.DB.prepare(
      "SELECT status FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(created.value.paymentIntentId)
      .first<{ status: string }>();
    expect(reaction?.status).toBe("PENDING");
  });
});
