import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { reconcilePayment } from "./reconcile-payment";
import {
  createMockPaymentProvider,
  setMockObservedState,
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
    providerCode: "mock",
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
    const provider = mock();
    const { intentId, reference } = await seededIntent();
    setMockObservedState(provider, reference, "SUCCEEDED");

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
    const provider = mock();
    const { intentId, reference } = await seededIntent();
    // Force the stored state to a terminal value; any observation disagrees.
    await env.DB.prepare(
      "UPDATE payment_intent SET status='EXPIRED', version=version+1, updated_at=? WHERE id=?",
    )
      .bind(Date.now(), intentId)
      .run();
    setMockObservedState(provider, reference, "SUCCEEDED");
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

function recoveryCommand(intentId: string) {
  return {
    paymentIntentId: intentId,
    idempotencyKey: crypto.randomUUID(),
    actorId: "system:recovery",
    requestId: crypto.randomUUID(),
  };
}

describe("payment lookup evidence and transaction guards", () => {
  it.each(["reference", "amount", "currency"] as const)(
    "rejects mismatched %s before financial effects",
    async (kind) => {
      const { intentId, reference } = await seededIntent();
      const lookup = vi.spyOn(mock(), "getPayment").mockResolvedValueOnce({
        providerReference: kind === "reference" ? "unrelated" : reference,
        amountMinor: kind === "amount" ? 1 : 15000,
        currency: kind === "currency" ? "USD" : "PHP",
        canonicalState: "SUCCEEDED",
      });
      try {
        expect(
          await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId)),
        ).toMatchObject({ ok: true, value: { processingStatus: "RECONCILIATION_REQUIRED" } });
        expect(
          await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
            .bind(intentId)
            .first(),
        ).toEqual({ status: "REQUIRES_ACTION" });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM payment_reaction WHERE payment_intent_id=?",
          )
            .bind(intentId)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        lookup.mockRestore();
      }
    },
  );

  it.each(["version", "reference", "subject", "late-failure"] as const)(
    "rolls back dependent effects after %s changes",
    async (kind) => {
      const { intentId, reference } = await seededIntent();
      setMockObservedState(mock(), reference, "SUCCEEDED");
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "version")
                await target
                  .prepare("UPDATE payment_intent SET version=version+1 WHERE id=?")
                  .bind(intentId)
                  .run();
              if (kind === "reference")
                await target
                  .prepare(
                    "UPDATE payment_attempt SET provider_reference='changed-reference' WHERE payment_intent_id=?",
                  )
                  .bind(intentId)
                  .run();
              if (kind === "subject")
                await target
                  .prepare("UPDATE payment_intent SET subject_id='changed-subject' WHERE id=?")
                  .bind(intentId)
                  .run();
              return target.batch(
                kind === "late-failure"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-41)")]
                  : statements,
              );
            };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await reconcilePayment(database, testRegistry(), recoveryCommand(intentId)),
      ).toMatchObject({ ok: true, value: { processingStatus: "RETRY_REQUIRED" } });
      expect(reached).toBe(true);
      expect(
        await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(intentId).first(),
      ).toEqual({ status: "REQUIRES_ACTION" });
      expect(
        await env.DB.prepare("SELECT status FROM payment_attempt WHERE payment_intent_id=?")
          .bind(intentId)
          .first(),
      ).toEqual({ status: "REQUIRES_ACTION" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM payment_reaction WHERE payment_intent_id=?",
        )
          .bind(intentId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM payment_provider_action WHERE payment_intent_id=?")
          .bind(intentId)
          .first(),
      ).toEqual({ status: "ACTIVE" });
    },
  );

  it("repairs a historical missing paid reaction without incrementing the payment on replay", async () => {
    const { intentId, reference } = await seededIntent();
    setMockObservedState(mock(), reference, "SUCCEEDED");
    expect(await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId))).toMatchObject(
      { ok: true, value: { processingStatus: "APPLIED" } },
    );
    const payment = await env.DB.prepare(
      "SELECT status,version,updated_at FROM payment_intent WHERE id=?",
    )
      .bind(intentId)
      .first();
    // Model retained evidence from the old unguarded projection, after reaching capture through the command.
    await env.DB.prepare("DELETE FROM payment_reaction WHERE payment_intent_id=?")
      .bind(intentId)
      .run();
    for (let index = 0; index < 2; index++)
      expect(
        await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId)),
      ).toMatchObject({ ok: true, value: { processingStatus: "APPLIED" } });
    expect(
      await env.DB.prepare("SELECT status,version,updated_at FROM payment_intent WHERE id=?")
        .bind(intentId)
        .first(),
    ).toEqual(payment);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM payment_reaction WHERE payment_intent_id=?")
        .bind(intentId)
        .first(),
    ).toEqual({ count: 1 });
  });
});

it("does not commit paid state when a dependent reaction insert is ignored", async () => {
  const { intentId, reference } = await seededIntent();
  setMockObservedState(mock(), reference, "SUCCEEDED");
  await env.DB.prepare(
    `CREATE TRIGGER test_ignore_paid_reaction BEFORE INSERT ON payment_reaction WHEN NEW.payment_intent_id='${intentId}' BEGIN SELECT RAISE(IGNORE); END`,
  ).run();
  try {
    expect(await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId))).toMatchObject(
      { ok: true, value: { processingStatus: "RETRY_REQUIRED" } },
    );
    expect(
      await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(intentId).first(),
    ).toEqual({ status: "PROCESSING" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_attempt WHERE payment_intent_id=?")
        .bind(intentId)
        .first(),
    ).toEqual({ status: "PROCESSING" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_provider_action WHERE payment_intent_id=?")
        .bind(intentId)
        .first(),
    ).toEqual({ status: "ACTIVE" });
    await env.DB.prepare("DROP TRIGGER test_ignore_paid_reaction").run();
    expect(await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId))).toMatchObject(
      { ok: true, value: { processingStatus: "APPLIED" } },
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM payment_reaction WHERE payment_intent_id=?")
        .bind(intentId)
        .first(),
    ).toEqual({ count: 1 });
  } finally {
    await env.DB.prepare("DROP TRIGGER IF EXISTS test_ignore_paid_reaction").run();
  }
});

it("preserves an existing paid reaction with a retained idempotency identity", async () => {
  const { intentId, reference } = await seededIntent();
  setMockObservedState(mock(), reference, "SUCCEEDED");
  await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId));
  const retainedKey = `retained-${crypto.randomUUID()}`;
  await env.DB.prepare("UPDATE payment_reaction SET idempotency_key=? WHERE payment_intent_id=?")
    .bind(retainedKey, intentId)
    .run();
  const before = await env.DB.prepare(
    "SELECT id,idempotency_key,status FROM payment_reaction WHERE payment_intent_id=?",
  )
    .bind(intentId)
    .all();
  expect(await reconcilePayment(env.DB, testRegistry(), recoveryCommand(intentId))).toMatchObject({
    ok: true,
    value: { processingStatus: "APPLIED" },
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT id,idempotency_key,status FROM payment_reaction WHERE payment_intent_id=?",
      )
        .bind(intentId)
        .all()
    ).results,
  ).toEqual(before.results);
});
