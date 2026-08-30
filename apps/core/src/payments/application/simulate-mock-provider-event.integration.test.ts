import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createPayment } from "./create-payment";
import { simulateMockProviderEvent } from "./simulate-mock-provider-event";
import { createMockPaymentProvider } from "../infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";

function registry() {
  return new ProviderRegistry("test", [createMockPaymentProvider()]);
}

async function seedPayment() {
  const customerId = `cust-simulator-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, Date.now(), Date.now())
    .run();
  const providers = registry();
  const payment = await createPayment(env.DB, providers, {
    purpose: "MEMBERSHIP_ENROLLMENT",
    subjectType: "subscription",
    subjectId: `sub-${crypto.randomUUID()}`,
    customerId,
    amountMinor: 29_900,
    currency: "PHP",
    providerCode: "mock",
    returnUrl: "https://freshmarkets.test/account/membership",
    idempotencyKey: `sim-payment-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  expect(payment.ok).toBe(true);
  if (!payment.ok) throw new Error("payment fixture failed");
  const attempt = await env.DB.prepare(
    "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
  )
    .bind(payment.value.paymentIntentId)
    .first<{ provider_reference: string }>();
  return {
    customerId,
    paymentIntentId: payment.value.paymentIntentId,
    providerReference: attempt!.provider_reference,
    providers,
  };
}

describe("mock provider event simulator", () => {
  it("returns NOT_FOUND outside development and test", async () => {
    const outcome = await simulateMockProviderEvent(env.DB, registry(), {
      environment: "production",
      customerId: "customer-hidden",
      providerReference: "mock_pay_hidden",
      outcome: "SUCCEEDED",
      idempotencyKey: "production-hidden",
      requestId: "production-request",
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", requestId: "production-request" },
    });
  });

  it("derives the owned Payment and submits a signed success through normal ingestion", async () => {
    const fixture = await seedPayment();
    const command = {
      environment: "test" as const,
      customerId: fixture.customerId,
      providerReference: fixture.providerReference,
      outcome: "SUCCEEDED" as const,
      idempotencyKey: `simulate-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    };
    const first = await simulateMockProviderEvent(env.DB, fixture.providers, command);
    expect(first).toMatchObject({
      ok: true,
      value: {
        providerReference: fixture.providerReference,
        outcome: "SUCCEEDED",
        processingStatus: "APPLIED",
        paymentIntentId: fixture.paymentIntentId,
      },
    });
    const payment = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(fixture.paymentIntentId)
      .first<{ status: string }>();
    expect(payment?.status).toBe("SUCCEEDED");
    const settlement = await env.DB.prepare(
      "SELECT gross_minor, processing_cost_minor, net_minor FROM payment_settlement_observation WHERE payment_intent_id=?",
    )
      .bind(fixture.paymentIntentId)
      .first<{ gross_minor: number; processing_cost_minor: number; net_minor: number }>();
    expect(settlement).toEqual({
      gross_minor: 29_900,
      processing_cost_minor: 0,
      net_minor: 29_900,
    });

    const replay = await simulateMockProviderEvent(env.DB, fixture.providers, command);
    expect(replay).toEqual(first);
    const conflict = await simulateMockProviderEvent(env.DB, fixture.providers, {
      ...command,
      outcome: "FAILED",
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("does not reveal or mutate another customer's Payment", async () => {
    const fixture = await seedPayment();
    const outcome = await simulateMockProviderEvent(env.DB, fixture.providers, {
      environment: "test",
      customerId: `other-${crypto.randomUUID()}`,
      providerReference: fixture.providerReference,
      outcome: "FAILED",
      idempotencyKey: `simulate-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(outcome).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const payment = await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(fixture.paymentIntentId)
      .first<{ status: string }>();
    expect(payment?.status).toBe("REQUIRES_ACTION");
  });
});
