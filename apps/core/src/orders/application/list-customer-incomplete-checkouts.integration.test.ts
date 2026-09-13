import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listCustomerIncompleteCheckouts } from "./list-customer-incomplete-checkouts";

describe("customer incomplete checkout read", () => {
  it("returns only owned uncommitted grocery payments and exposes only a fresh action", async () => {
    const now = Date.now();
    const customerId = crypto.randomUUID();
    const otherCustomerId = crypto.randomUUID();
    const addressId = crypto.randomUUID();
    const quoteId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(otherCustomerId, `auth-${otherCustomerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','09','{}',10.3,123.9,'active',1,?,?)",
      ).bind(addressId, customerId, now, now),
      env.DB.prepare(`INSERT INTO checkout_quote
          (id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,
           subtotal_minor,total_minor,lines_json,status,version,expires_at,idempotency_key,created_at,updated_at)
          VALUES (?,?,?,?,?,NULL,'INSTANT','PHP',100,15000,?,'ACTIVE',1,?,?,?,?)`).bind(
        quoteId,
        quoteId,
        customerId,
        crypto.randomUUID(),
        addressId,
        JSON.stringify([{ quantity: 2 }, { quantity: 1 }]),
        now + 60_000,
        crypto.randomUUID(),
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,15000,'PHP','REQUIRES_ACTION',?,?,?)",
      ).bind(paymentId, quoteId, customerId, crypto.randomUUID(), now, now),
      env.DB.prepare(
        `INSERT INTO payment_provider_action
        (id,payment_intent_id,provider,provider_reference,action_type,redirect_url,client_token,expires_at,status,created_at,updated_at)
       VALUES (?,?,'mock',?,'REDIRECT','https://payments.example/continue',NULL,?,'ACTIVE',?,?)`,
      ).bind(crypto.randomUUID(), paymentId, crypto.randomUUID(), now + 60_000, now, now),
    ]);

    const current = await listCustomerIncompleteCheckouts(
      env.DB,
      { customerId, requestId: "incomplete" },
      now,
    );
    expect(current).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            paymentIntentId: paymentId,
            checkoutAttemptId: quoteId,
            state: "REQUIRES_ACTION",
            fulfillmentMode: "INSTANT",
            totalMinor: 15000,
            currency: "PHP",
            itemCount: 3,
            action: {
              actionType: "REDIRECT",
              redirectUrl: "https://payments.example/continue",
            },
          },
        ],
      },
    });

    const expired = await listCustomerIncompleteCheckouts(
      env.DB,
      { customerId, requestId: "expired" },
      now + 60_001,
    );
    expect(expired).toMatchObject({
      ok: true,
      value: { items: [{ action: { actionType: "NONE", redirectUrl: null } }] },
    });

    expect(
      await listCustomerIncompleteCheckouts(
        env.DB,
        { customerId: otherCustomerId, requestId: "other" },
        now,
      ),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });
});
