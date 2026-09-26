import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { scheduledLateCaptureRefundsJob } from "./scheduled-late-capture-refunds";

it("claims one full refund only for captured Scheduled checkout money without an Order", async () => {
  const customerId = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  const reference = `mock_pay_${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(customerId, customerId),
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?, ?,5000,'PHP','SUCCEEDED',?,1,1)",
    ).bind(intentId, crypto.randomUUID(), customerId, intentId),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES (?,?,?,5000,'PHP','SUCCEEDED','mock',?,?,1,1)",
    ).bind(crypto.randomUUID(), customerId, intentId, reference, crypto.randomUUID()),
    env.DB.prepare(
      "INSERT INTO finance_exception(id,kind,payment_intent_id,details_json,status,created_at) VALUES (?,'CYCLE_CLOSED',?,'{}','OPEN',1)",
    ).bind(crypto.randomUUID(), intentId),
  ]);
  const registry = new ProviderRegistry("test", [createMockPaymentProvider()]);
  const context = {
    database: env.DB,
    registry,
    now: Date.now(),
    emailDelivery: { send: async () => ({ ok: true as const }) },
  };
  expect(await scheduledLateCaptureRefundsJob.run(context)).toMatchObject({
    status: "SUCCEEDED",
    affected: 1,
  });
  expect(await scheduledLateCaptureRefundsJob.run(context)).toMatchObject({
    status: "SUCCEEDED",
    affected: 0,
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n,SUM(amount_minor) amount FROM payment_refund WHERE payment_intent_id=?",
    )
      .bind(intentId)
      .first(),
  ).toEqual({ n: 1, amount: 5000 });
});
