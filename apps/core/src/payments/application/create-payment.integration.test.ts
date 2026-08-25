import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment, type CreatePaymentCommand } from "./create-payment";
import { createFakePaymentProvider } from "../infrastructure/providers/fake-payment-provider";
import {
  FakeProviderProductionError,
  ProviderRegistry,
} from "../infrastructure/providers/provider-registry";

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
    providerCode: "fake",
    returnUrl: "https://app.example/membership",
    idempotencyKey: `pay-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createFakePaymentProvider()]);
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
    expect(result.value.redirectUrl).toContain("fake.pay.example");
    const { row, attempts } = await intentRows(attempt.idempotencyKey);
    expect(row).toMatchObject({ status: "REQUIRES_ACTION", version: 2 });
    expect(attempts).toBe(1);
  });

  it("replays the same result for the same key and payload without new side effects", async () => {
    const attempt = await command();
    const first = await createPayment(env.DB, testRegistry(), attempt);
    expect(first.ok).toBe(true);
    const replay = await createPayment(env.DB, testRegistry(), attempt);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.value.paymentIntentId).toBe(first.value.paymentIntentId);
    const { attempts } = await intentRows(attempt.idempotencyKey);
    expect(attempts).toBe(1);
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

  it("blocks the fake provider outside the test environment", () => {
    expect(() => new ProviderRegistry("production", [createFakePaymentProvider()])).toThrow(
      FakeProviderProductionError,
    );
    expect(() => new ProviderRegistry("development", [createFakePaymentProvider()])).toThrow(
      FakeProviderProductionError,
    );
  });
});
