import { getJobsForCron } from "../../scheduling/job-registry";
import { setMockObservedState } from "../infrastructure/providers/mock-payment-provider";
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment, type CreatePaymentCommand } from "./create-payment";
import { createMockPaymentProvider } from "../infrastructure/providers/mock-payment-provider";
import {
  MockProviderEnvironmentError,
  ProviderRegistry,
} from "../infrastructure/providers/provider-registry";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import { applyObservationToIntents } from "./apply-observation";

let customerIdCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-seeded-${++customerIdCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

async function command(
  overrides: Partial<CreatePaymentCommand> = {},
): Promise<CreatePaymentCommand> {
  return {
    purpose: "MEMBERSHIP_ENROLLMENT",
    subjectType: "subscription",
    subjectId: `sub-${crypto.randomUUID()}`,
    customerId: await seedCustomer(),
    amountMinor: 29900,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://app.example/membership",
    idempotencyKey: `pay-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createMockPaymentProvider()]);
}

async function intentRows(idempotencyKey: string) {
  const row = await env.DB.prepare(
    "SELECT id, status, version FROM payment_intent WHERE idempotency_key=?",
  )
    .bind(idempotencyKey)
    .first<{ id: string; status: string; version: number }>();
  const attempts = row
    ? await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM payment_attempt WHERE payment_intent_id=? AND status != 'SUCCEEDED'",
      )
        .bind(row.id)
        .first<{ count: number }>()
    : { count: 0 };
  return { row, attempts: attempts?.count ?? 0 };
}

describe("payment intent creation", () => {
  it("creates an intent with a redirect action and never canonical success", async () => {
    const attempt = await command();
    const result = await createPayment(env.DB, testRegistry(), attempt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("REQUIRES_ACTION");
    expect(result.value.actionType).toBe("REDIRECT");
    expect(result.value.redirectUrl).toContain(
      "https://app.example/development/mock-payments/mock_pay_",
    );
    expect(result.value.redirectUrl).toContain("returnTo=%2Fmembership");
    const { row, attempts } = await intentRows(attempt.idempotencyKey);
    expect(row).toMatchObject({ status: "REQUIRES_ACTION", version: 2 });
    expect(attempts).toBe(1);
  });

  it("durably persists the provider customer before creating the payment", async () => {
    const attempt = await command();

    const result = await createPayment(env.DB, testRegistry(), attempt);

    expect(result.ok).toBe(true);
    const mapping = await env.DB.prepare(
      "SELECT provider, provider_customer_ref FROM payment_provider_customer WHERE customer_id=?",
    )
      .bind(attempt.customerId)
      .first<{ provider: string; provider_customer_ref: string }>();
    expect(mapping).toEqual({
      provider: "mock",
      provider_customer_ref: `mock_cust_${attempt.customerId}`,
    });
  });

  it("does not let a different provider overwrite an owned customer mapping", async () => {
    const attempt = await command();
    await env.DB.prepare(
      "INSERT INTO payment_provider_customer (id, customer_id, provider, provider_customer_ref, created_at, updated_at) VALUES (?, ?, 'secondary', ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        attempt.customerId,
        `secondary_cust_${attempt.customerId}`,
        Date.now(),
        Date.now(),
      )
      .run();

    const result = await createPayment(env.DB, testRegistry(), attempt);

    expect(result).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const mapping = await env.DB.prepare(
      "SELECT provider, provider_customer_ref FROM payment_provider_customer WHERE customer_id=?",
    )
      .bind(attempt.customerId)
      .first<{ provider: string; provider_customer_ref: string }>();
    expect(mapping?.provider).toBe("secondary");
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_attempt WHERE payment_intent_id=(SELECT id FROM payment_intent WHERE idempotency_key=?)",
    )
      .bind(attempt.idempotencyKey)
      .first<{ count: number }>();
    expect(attempts?.count).toBe(0);
  });

  it("replays the same result for the same key and payload without new side effects", async () => {
    const attempt = await command();
    const first = await createPayment(env.DB, testRegistry(), attempt);
    expect(first.ok).toBe(true);
    const replay = await createPayment(env.DB, testRegistry(), attempt);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.value.paymentIntentId).toBe(first.value.paymentIntentId);
    expect(replay.value.actionType).toBe("REDIRECT");
    expect(replay.value.redirectUrl).toBe(first.value.redirectUrl);
    expect(replay.value.redirectUrl).not.toBeNull();
    expect(replay.value.expiresAt).toBe(first.value.expiresAt);
    const { attempts } = await intentRows(attempt.idempotencyKey);
    expect(attempts).toBe(1);
  });

  it("records a provider timeout as unresolved instead of definitive failure", async () => {
    const attempt = await command();
    const timedOutProvider = {
      ...createMockPaymentProvider(),
      async createPayment(): Promise<never> {
        throw new Error("provider timeout");
      },
    };

    const result = await createPayment(
      env.DB,
      new ProviderRegistry("test", [timedOutProvider]),
      attempt,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_OUTCOME_UNRESOLVED" },
    });
    const intent = await env.DB.prepare(
      "SELECT id, status FROM payment_intent WHERE idempotency_key=?",
    )
      .bind(attempt.idempotencyKey)
      .first<{ id: string; status: string }>();
    expect(intent?.status).toBe("INITIATED");
    const reconciliation = await env.DB.prepare(
      "SELECT category, status FROM payment_reconciliation_case WHERE payment_intent_id=?",
    )
      .bind(intent!.id)
      .first<{ category: string; status: string }>();
    expect(reconciliation).toEqual({ category: "AMBIGUOUS_OUTCOME", status: "OPEN" });
  });

  it("consumes the stored continuation when a terminal provider outcome lands", async () => {
    const attempt = await command();
    const created = await createPayment(env.DB, testRegistry(), attempt);
    if (!created.ok) throw new Error(created.error.message);
    const intent = await createPaymentRepository(env.DB).findIntentById(
      created.value.paymentIntentId,
    );
    if (!intent) throw new Error("intent not found");

    const providerAttempt = await env.DB.prepare(
      "SELECT provider, provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(intent.id)
      .first<{ provider: string; provider_reference: string }>();
    if (!providerAttempt) throw new Error("Attempt missing");
    const applied = await applyObservationToIntents(env.DB, [intent], "SUCCEEDED", {
      provider: providerAttempt.provider,
      providerReference: providerAttempt.provider_reference,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
    });

    expect(applied.processingStatus).toBe("APPLIED");
    const action = await env.DB.prepare(
      "SELECT status FROM payment_provider_action WHERE payment_intent_id=?",
    )
      .bind(intent.id)
      .first<{ status: string }>();
    expect(action?.status).toBe("CONSUMED");
  });

  it("rejects key reuse with a different payload", async () => {
    const attempt = await command();
    await createPayment(env.DB, testRegistry(), attempt);
    const conflict = await createPayment(env.DB, testRegistry(), { ...attempt, amountMinor: 100 });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("rejects invalid amounts and unknown providers before contacting anyone", async () => {
    const badAmount = await createPayment(
      env.DB,
      testRegistry(),
      await command({ amountMinor: 0 }),
    );
    expect(badAmount).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const attempt = await command({ providerCode: "unregistered" });
    const unknownProvider = await createPayment(env.DB, testRegistry(), attempt);
    expect(unknownProvider).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
    const row = await env.DB.prepare("SELECT status FROM payment_intent WHERE idempotency_key=?")
      .bind(attempt.idempotencyKey)
      .first<{ status: string }>();
    expect(row?.status).toBe("FAILED");
  });

  it("blocks the mock provider outside allowed environments", () => {
    expect(() => new ProviderRegistry("production", [createMockPaymentProvider()])).toThrow(
      MockProviderEnvironmentError,
    );
    expect(
      new ProviderRegistry("development", [createMockPaymentProvider()]).get("mock"),
    ).not.toBeNull();
  });
  it("does not publish an attempt or continuation when the initial Payment transition loses", async () => {
    const input = await command({ purpose: "GROCERY_CHECKOUT", subjectType: "checkout_attempt" });
    await env.DB.exec(
      "CREATE TRIGGER ignore_creation_transition BEFORE UPDATE ON payment_intent WHEN OLD.status='INITIATED' AND NEW.status IN ('REQUIRES_ACTION','PROCESSING') BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await createPayment(env.DB, testRegistry(), input)).toMatchObject({
        ok: false,
        error: { code: "PAYMENT_OUTCOME_UNRESOLVED" },
      });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_creation_transition");
    }
    const intent = await env.DB.prepare(
      "SELECT id,status FROM payment_intent WHERE idempotency_key=?",
    )
      .bind(input.idempotencyKey)
      .first<{ id: string; status: string }>();
    if (!intent) throw new Error("Missing retained payment identity");
    expect(intent.status).toBe("INITIATED");
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_attempt WHERE payment_intent_id=?")
        .bind(intent.id)
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM payment_provider_action WHERE payment_intent_id=?",
      )
        .bind(intent.id)
        .first(),
    ).toEqual({ n: 0 });
  });
  it.each(["replay", "registered lookup"])(
    "recovers retained creation through %s without another provider submission",
    async (recovery) => {
      const provider = createMockPaymentProvider(),
        registry = new ProviderRegistry("test", [provider]);
      const submission = vi.spyOn(provider, "createPayment");
      const input = await command({ purpose: "GROCERY_CHECKOUT", subjectType: "checkout_attempt" });
      await env.DB.exec(
        "CREATE TRIGGER ignore_creation_audit BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.CREATION_APPLIED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        expect(await createPayment(env.DB, registry, input)).toMatchObject({
          ok: false,
          error: { code: "PAYMENT_OUTCOME_UNRESOLVED" },
        });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_creation_audit");
      }
      const saved = await env.DB.prepare(
        "SELECT payment_intent_id,provider_reference,applied_at FROM payment_creation_observation WHERE payment_intent_id=(SELECT id FROM payment_intent WHERE idempotency_key=?)",
      )
        .bind(input.idempotencyKey)
        .first<{
          payment_intent_id: string;
          provider_reference: string;
          applied_at: number | null;
        }>();
      if (!saved) throw new Error("Missing durable creation response");
      expect(saved.applied_at).toBeNull();
      if (recovery === "replay") {
        const concurrent = await Promise.all([
          createPayment(env.DB, registry, input),
          createPayment(env.DB, registry, input),
        ]);
        const recovered = concurrent[0];
        expect(concurrent[1]).toEqual(recovered);
        expect(recovered).toMatchObject({
          ok: true,
          value: {
            paymentIntentId: saved.payment_intent_id,
            state: "REQUIRES_ACTION",
            actionType: "REDIRECT",
          },
        });
        expect(await createPayment(env.DB, registry, input)).toEqual(recovered);
      } else {
        setMockObservedState(provider, saved.provider_reference, "FAILED");
        const job = getJobsForCron("*/15 * * * *").find(
          (job) => job.name === "payments.reconciliation-redrive",
        );
        if (!job) throw new Error("Missing registered lookup");
        await job.run({
          database: env.DB,
          registry,
          now: Date.now() + 20 * 60000,
          emailDelivery: { send: async () => ({ ok: false, code: "TEST_DISABLED" }) },
        });
        expect(
          await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
            .bind(saved.payment_intent_id)
            .first(),
        ).toEqual({ status: "FAILED" });
      }
      expect(submission).toHaveBeenCalledTimes(1);
      expect(
        await env.DB.prepare("SELECT COUNT(*) n FROM payment_attempt WHERE payment_intent_id=?")
          .bind(saved.payment_intent_id)
          .first(),
      ).toEqual({ n: 1 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.CREATION_APPLIED'",
        )
          .bind(saved.payment_intent_id)
          .first(),
      ).toEqual({ n: 1 });
      expect(
        await env.DB.prepare(
          "SELECT applied_at FROM payment_creation_observation WHERE payment_intent_id=?",
        )
          .bind(saved.payment_intent_id)
          .first(),
      ).toMatchObject({ applied_at: expect.any(Number) });
    },
  );
  it.each(["payment_attempt", "payment_provider_action"])(
    "rolls back ignored %s and recovers the saved provider response",
    async (table) => {
      const provider = createMockPaymentProvider(),
        registry = new ProviderRegistry("test", [provider]);
      const submit = vi.spyOn(provider, "createPayment");
      const input = await command({ purpose: "GROCERY_CHECKOUT", subjectType: "checkout_attempt" });
      await env.DB.exec(
        `CREATE TRIGGER ignore_creation_effect BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await createPayment(env.DB, registry, input)).toMatchObject({ ok: false });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_creation_effect");
      }
      const before = await intentRows(input.idempotencyKey);
      expect(before.row?.status).toBe("INITIATED");
      expect(before.attempts).toBe(0);
      expect(await createPayment(env.DB, registry, input)).toMatchObject({
        ok: true,
        value: { state: "REQUIRES_ACTION" },
      });
      expect(submit).toHaveBeenCalledTimes(1);
      const after = await intentRows(input.idempotencyKey);
      expect(after.attempts).toBe(1);
      await expect(
        env.DB.prepare(
          "UPDATE payment_creation_observation SET amount_minor=amount_minor+1 WHERE payment_intent_id=?",
        )
          .bind(after.row?.id ?? "")
          .run(),
      ).rejects.toThrow(/immutable/);
    },
  );
});
