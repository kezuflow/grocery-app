import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { mockSignatureFor } from "./payments/infrastructure/providers/mock-payment-provider";
import { buildProviderRegistry } from "./payments/infrastructure/providers/runtime-providers";
import { redrivePaymentReactions } from "./payments/application/redrive-payment-reactions";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";

function requestId() {
  return crypto.randomUUID();
}

/** Program 3: the trial gate requires a recurring-capable authorization. */
async function seedMembershipAuthorization(authUserId: string) {
  const customerId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, authUserId, now, now),
    env.DB.prepare(
      "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
    ).bind(
      `authz-${customerId}`,
      customerId,
      `mock_auth_${customerId}`,
      `mock_method_${customerId}`,
      now,
      now,
      now,
    ),
  ]);
}

function cookieHeader(response: Response): string {
  return (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function authenticatedCookie() {
  const email = `flow-${crypto.randomUUID()}@example.com`;
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Flow Test", email, password }),
  });
  expect(signUp.status).toBeLessThan(400);
  const body = (await signUp.json()) as { user?: { id?: string } };
  if (body.user?.id) {
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
    await seedMembershipAuthorization(body.user.id);
  }
  const cookie = cookieHeader(signUp);
  if (cookie) return cookie;
  const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password }),
  });
  expect(signIn.status).toBeLessThan(400);
  return cookieHeader(signIn);
}

describe("customer checkout flow", () => {
  it("commits one order and replays the same result", async () => {
    const cookie = await authenticatedCookie();
    const headers = { cookie };
    const request = () => ({ headers, requestId: requestId() });

    const trial = await core.startTrial({
      ...request(),
      idempotencyKey: `trial-${crypto.randomUUID()}`,
    });
    expect(trial.ok).toBe(true);
    const address = await core.createCustomerAddress({
      ...request(),
      label: "Home",
      recipient: "Flow Test",
      phone: "09000000000",
      addressJson: JSON.stringify({ line1: "Cebu City" }),
      latitude: 10.32,
      longitude: 123.9,
    });
    expect(address.ok).toBe(true);
    if (!address.ok) return;
    const cart = await core.getCart(request());
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    const item = await core.setCartItem({
      ...request(),
      skuId: "sku-red-onion-500g",
      quantity: 4,
    });
    expect(item.ok).toBe(true);
    const cycles = await core.listDeliveryCycles({ requestId: requestId() });
    expect(cycles.ok).toBe(true);
    if (!cycles.ok || cycles.value.length === 0) return;
    const checkoutInput = {
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      cycleId: cycles.value[0].id,
    };
    const eligibility = await core.evaluateCheckout(checkoutInput);
    expect(eligibility).toMatchObject({ ok: true, value: { eligible: true } });

    // Canonical authoritative quote (idempotent replay, no payment artifacts).
    const cartNow = await core.getCart(request());
    if (!cartNow.ok) throw new Error("cart unavailable");
    const quoteKey = `flow-quote-${crypto.randomUUID()}`;
    const quote = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      deliveryCycleId: cycles.value[0].id,
      cartVersion: cartNow.value.version,
      idempotencyKey: quoteKey,
    });
    expect(quote).toMatchObject({
      ok: true,
      value: { totalMinor: quote.ok ? quote.value.totalMinor : 0 },
    });
    if (!quote.ok) return;
    const quoteReplay = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      deliveryCycleId: cycles.value[0].id,
      cartVersion: cartNow.value.version,
      idempotencyKey: quoteKey,
    });
    expect(quoteReplay.ok).toBe(true);
    if (!quoteReplay.ok) return;
    expect(quoteReplay.value.quoteId).toBe(quote.value.quoteId);
    await env.DB.prepare(
      "UPDATE price_version SET amount_minor=amount_minor+100 WHERE sku_id='sku-red-onion-500g' AND valid_to IS NULL",
    ).run();
    const changed = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: quote.value.quoteId,
      expectedTotalMinor: quote.value.totalMinor,
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: `flow-rejected-${crypto.randomUUID()}`,
    });
    expect(changed).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
    const intentsBeforeAcceptance = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_intent",
    ).first<{ count: number }>();
    expect(intentsBeforeAcceptance?.count).toBe(0);

    const acceptedQuote = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      deliveryCycleId: cycles.value[0].id,
      cartVersion: cartNow.value.version,
      idempotencyKey: `flow-accepted-${crypto.randomUUID()}`,
    });
    expect(acceptedQuote.ok).toBe(true);
    if (!acceptedQuote.ok) return;
    expect(acceptedQuote.value.totalMinor).toBeGreaterThan(quote.value.totalMinor);

    const paymentKey = `flow-payment-${crypto.randomUUID()}`;
    const payment = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      expectedTotalMinor: acceptedQuote.value.totalMinor,
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: paymentKey,
    });
    expect(payment).toMatchObject({
      ok: true,
      value: { state: "REQUIRES_ACTION", actionType: "REDIRECT" },
    });
    if (!payment.ok) return;

    const eventBody = JSON.stringify({
      eventId: `evt-${crypto.randomUUID()}`,
      reference: `mock_pay_${paymentKey}`,
      vendorState: "paid",
      amountMinor: acceptedQuote.value.totalMinor,
      currency: acceptedQuote.value.currency,
    });
    const timestamp = Date.now();
    const signature = await mockSignatureFor(eventBody);
    const firstWebhook = await SELF.fetch(
      new Request("https://core.example.invalid/webhooks/payments/mock", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-signature": signature,
          "x-mock-timestamp": String(timestamp),
        },
        body: eventBody,
      }),
    );
    expect(firstWebhook.status).toBe(200);
    const firstRedrive = await redrivePaymentReactions(
      env.DB,
      buildProviderRegistry({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" }),
      Date.now(),
    );
    const replayWebhook = await SELF.fetch(
      new Request("https://core.example.invalid/webhooks/payments/mock", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-signature": signature,
          "x-mock-timestamp": String(timestamp),
        },
        body: eventBody,
      }),
    );
    expect(replayWebhook.status).toBe(200);
    const secondRedrive = await redrivePaymentReactions(
      env.DB,
      buildProviderRegistry({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" }),
      Date.now(),
    );

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM payment_intent WHERE id=?) AS payments, (SELECT COUNT(*) FROM grocery_order WHERE customer_id=(SELECT customer_id FROM payment_intent WHERE id=?)) AS orders",
    )
      .bind(payment.value.paymentIntentId, payment.value.paymentIntentId)
      .first<{ payments: number; orders: number }>();
    const reaction = await env.DB.prepare(
      "SELECT status, attempts, last_error_code FROM payment_reaction WHERE payment_intent_id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ status: string; attempts: number; last_error_code: string | null }>();
    expect(counts).toEqual({ payments: 1, orders: 1 });
    expect(reaction).toMatchObject({ status: "SUCCEEDED" });
    expect(firstRedrive.applied).toBe(1);
    expect(secondRedrive.applied).toBe(0);
    const feeSnapshot = await env.DB.prepare(
      "SELECT s.delivery_fee_snapshot_json FROM order_fulfillment_snapshot s JOIN grocery_order o ON o.id=s.order_id WHERE o.customer_id=(SELECT customer_id FROM payment_intent WHERE id=?)",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ delivery_fee_snapshot_json: string }>();
    expect(JSON.parse(feeSnapshot!.delivery_fee_snapshot_json)).toEqual({
      marketId: "market-metro-cebu",
      locationId: "location-cebu-central",
      currency: "PHP",
      distanceMeters: 2_000,
      minimumDeliveryFeeMinor: 5_000,
      perKilometerRateMinor: 2_500,
      calculatedFeeMinor: 5_000,
      configurationVersion: 1,
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    });
  }, 15_000);
});
