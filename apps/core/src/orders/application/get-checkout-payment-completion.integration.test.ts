import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getCheckoutPaymentCompletion } from "./get-checkout-payment-completion";

describe("checkout payment completion read", () => {
  it("distinguishes provider success from an immutable order commitment and enforces ownership", async () => {
    const now = Date.now();
    const customerId = `completion-${crypto.randomUUID()}`;
    const otherCustomerId = `completion-other-${crypto.randomUUID()}`;
    const paymentIntentId = `payment-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
      env.DB.prepare(
        `INSERT INTO payment_intent
          (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at)
         VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,7100,'PHP','REQUIRES_ACTION',?,?,?)`,
      ).bind(
        paymentIntentId,
        `quote-${crypto.randomUUID()}`,
        customerId,
        crypto.randomUUID(),
        now,
        now,
      ),
    ]);

    await expect(
      getCheckoutPaymentCompletion(env.DB, {
        customerId,
        paymentIntentId,
        requestId: "waiting",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { paymentIntentId, state: "WAITING_FOR_PAYMENT", orderId: null },
    });
    await expect(
      getCheckoutPaymentCompletion(env.DB, {
        customerId: otherCustomerId,
        paymentIntentId,
        requestId: "other",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    await env.DB.prepare(
      "UPDATE payment_intent SET status='SUCCEEDED',version=version+1 WHERE id=?",
    )
      .bind(paymentIntentId)
      .run();
    await expect(
      getCheckoutPaymentCompletion(env.DB, {
        customerId,
        paymentIntentId,
        requestId: "paid",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { paymentIntentId, state: "FINALIZING_ORDER", orderId: null },
    });

    const orderId = `order-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at,checkout_quote_id) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        paymentIntentId,
        crypto.randomUUID(),
        orderId,
        now,
        `quote-link-${crypto.randomUUID()}`,
      )
      .run();
    await expect(
      getCheckoutPaymentCompletion(env.DB, {
        customerId,
        paymentIntentId,
        requestId: "complete",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { paymentIntentId, state: "COMPLETED", orderId },
    });
  });
});
