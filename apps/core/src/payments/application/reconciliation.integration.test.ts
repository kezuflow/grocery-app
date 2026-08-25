import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { reconcilePayment } from "./reconcile-payment";
import {
  createFakePaymentProvider,
  setFakeObservedState,
} from "../infrastructure/providers/fake-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

const sharedFake = createFakePaymentProvider();
function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [sharedFake]);
}
function fake() {
  return sharedFake;
}

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-rec-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function seededIntent() {
  const created = await createPayment(env.DB, testRegistry(), {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_attempt",
    subjectId: `ca-${crypto.randomUUID()}`,
    customerId: await seedCustomer(),
    amountMinor: 15000,
    currency: "PHP",
    providerCode: "fake",
    returnUrl: "https://app.example/return",
    idempotencyKey: `rec-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(created.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  return { intentId: created.value.paymentIntentId, reference: attempt!.provider_reference };
}

describe("payment reconciliation", () => {
  it("recovers a lost webhook through provider lookup exactly once", async () => {
    const provider = fake();
    const { intentId, reference } = await seededIntent();
    setFakeObservedState(provider, reference, "SUCCEEDED");

    const first = await reconcilePayment(env.DB, testRegistry(), {
      paymentIntentId: intentId,
      idempotencyKey: `recon-${crypto.randomUUID()}`,
      actorId: "ops-1",
      requestId: crypto.randomUUID(),
    });
    expect(first).toMatchObject({
      ok: true,
      value: { processingStatus: "APPLIED", canonicalState: "SUCCEEDED" },
    });
    const reactions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reaction WHERE payment_intent_id=? AND reaction_type='COMMIT_ORDER' AND status='PENDING'",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(reactions?.count).toBe(1);

    // Duplicate reconciliation stays idempotent and never duplicates effects.
    const second = await reconcilePayment(env.DB, testRegistry(), {
      paymentIntentId: intentId,
      idempotencyKey: `recon-${crypto.randomUUID()}`,
      actorId: "ops-1",
      requestId: crypto.randomUUID(),
    });
    expect(second).toMatchObject({ ok: true, value: { processingStatus: "APPLIED" } });
    const reactionTotal = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(reactionTotal?.count).toBe(1);
  });

  it("records an open case when no provider attempt is linked", async () => {
    const intentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'MEMBERSHIP_RENEWAL', 'subscription', ?, ?, 29900, 'PHP', 'PROCESSING', ?, 3, ?, ?)",
    )
      .bind(
        intentId,
        `sub-${intentId}`,
        `cust-${intentId}`,
        `orphan-${crypto.randomUUID()}`,
        Date.now(),
        Date.now(),
      )
      .run();
    const outcome = await reconcilePayment(env.DB, testRegistry(), {
      paymentIntentId: intentId,
      idempotencyKey: `recon-${crypto.randomUUID()}`,
      actorId: "ops-1",
      requestId: crypto.randomUUID(),
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: { processingStatus: "RECONCILIATION_REQUIRED" },
    });
    const cases = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='UNMAPPED_PROVIDER_REFERENCE' AND status='OPEN'",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(cases?.count).toBe(1);
  });

  it("reports terminal-state disagreement as reconciliation required without mutation", async () => {
    const provider = fake();
    const { intentId, reference } = await seededIntent();
    // Force the stored state to a terminal value; any observation disagrees.
    await env.DB.prepare(
      "UPDATE payment_intent SET status='EXPIRED', version=version+1, updated_at=? WHERE id=?",
    )
      .bind(Date.now(), intentId)
      .run();
    setFakeObservedState(provider, reference, "SUCCEEDED");
    const outcome = await reconcilePayment(env.DB, testRegistry(), {
      paymentIntentId: intentId,
      idempotencyKey: `recon-${crypto.randomUUID()}`,
      actorId: "ops-1",
      requestId: crypto.randomUUID(),
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: { processingStatus: "RECONCILIATION_REQUIRED", canonicalState: "SUCCEEDED" },
    });
    const row = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(intentId)
      .first<{ status: string }>();
    expect(row?.status).toBe("EXPIRED");
  });
});
