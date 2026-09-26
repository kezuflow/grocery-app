import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { scheduledLateCaptureRefundsJob } from "./scheduled-late-capture-refunds";

it("claims one full refund only for captured Scheduled checkout money without an Order", async () => {
  const customerId = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  const cycleId = crypto.randomUUID();
  const quoteId = crypto.randomUUID();
  const cartId = crypto.randomUUID();
  const addressId = crypto.randomUUID();
  const reference = `mock_pay_${crypto.randomUUID()}`;
  await seedTestCycle(env.DB, cycleId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(customerId, customerId),
    env.DB.prepare(
      "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,created_at,updated_at) VALUES (?,?,'Home','Test','+639171110000','{}',1,1,'active',1,1)",
    ).bind(addressId, customerId),
    env.DB.prepare(
      "INSERT INTO cart(id,customer_id,location_id,status,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',1,1)",
    ).bind(cartId, customerId),
    env.DB.prepare(
      "INSERT INTO delivery_cycle_schedule(cycle_id,timezone,procurement_at,preparation_at,pickup_at,created_at,updated_at) VALUES (?,'Asia/Manila',1,2,3,1,1)",
    ).bind(cycleId),
    env.DB.prepare(
      "INSERT INTO checkout_quote(id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,status,expires_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,'SCHEDULED','PHP',5000,5000,'[]','EXPIRED',2,?,1,1)",
    ).bind(
      quoteId,
      crypto.randomUUID(),
      customerId,
      cartId,
      addressId,
      cycleId,
      crypto.randomUUID(),
    ),
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?, ?,5000,'PHP','SUCCEEDED',?,1,1)",
    ).bind(intentId, quoteId, customerId, intentId),
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
