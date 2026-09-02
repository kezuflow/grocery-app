import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CheckoutQuoteView, CoreServiceBinding } from "@freshmarkets/contracts";
import { buildProviderRegistry } from "./payments/infrastructure/providers/runtime-providers";
import { simulateMockProviderEvent } from "./payments/application/simulate-mock-provider-event";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";

function requestId() {
  return crypto.randomUUID();
}

function acceptedPrice(quote: CheckoutQuoteView) {
  return {
    expectedQuoteVersion: quote.attemptVersion,
    expectedPriceAcceptanceVersion: quote.priceAcceptanceVersion,
    expectedCurrency: quote.currency,
    expectedMerchandiseSubtotalMinor: quote.merchandiseSubtotalMinor,
    expectedItemDiscountMinor: quote.itemDiscountMinor,
    expectedOrderDiscountMinor: quote.orderDiscountMinor,
    expectedDeliverySubtotalMinor: quote.deliverySubtotalMinor,
    expectedDeliveryFeeMinor: quote.deliveryFeeMinor,
    expectedDeliveryDiscountMinor: quote.deliveryDiscountMinor,
    expectedServiceFeeMinor: quote.serviceFeeMinor,
    expectedTaxMinor: quote.taxMinor,
    expectedTotalMinor: quote.totalMinor,
  };
}

/** Ensure the authenticated identity has its application Customer record. */
async function seedCustomerProfile(authUserId: string) {
  const customerId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, authUserId, now, now)
    .run();
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
    await seedCustomerProfile(body.user.id);
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
      components: {
        addressLine1: "Cebu City",
        addressLine2: null,
        barangay: null,
        city: "Cebu City",
        region: null,
        postalCode: null,
        countryCode: "PH",
      },
      componentsSource: "FIRST_PARTY",
      confirmationSource: "USER_PIN",
      instructions: {
        buildingUnit: null,
        landmark: null,
        gateGuard: null,
        deliveryNote: null,
        recipientInstruction: null,
      },
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
      cartId: cart.value.id,
      skuId: "sku-red-onion-500g",
      quantity: 4,
      expectedVersion: cart.value.version,
      idempotencyKey: `cart-set-${crypto.randomUUID()}`,
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
    await env.DB.prepare(
      "UPDATE global_fulfillment_mode SET active_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
    )
      .bind(Date.now())
      .run();
    const options = await core.listFulfillmentOptions({
      ...request(),
      addressId: address.value.id,
      addressVersion: address.value.version,
      cartId: cart.value.id,
      cartVersion: cartNow.value.version,
    });
    if (!options.ok) throw new Error("fulfillment options unavailable");
    const scheduledOption = options.value.find(
      (option) => option.mode === "SCHEDULED" && option.eligible,
    );
    if (!scheduledOption) throw new Error("scheduled option unavailable");
    const quoteKey = `flow-quote-${crypto.randomUUID()}`;
    const quote = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      fulfillmentOptionId: scheduledOption.optionId,
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
      fulfillmentOptionId: scheduledOption.optionId,
      cartVersion: cartNow.value.version,
      idempotencyKey: quoteKey,
    });
    expect(quoteReplay.ok).toBe(true);
    if (!quoteReplay.ok) return;
    expect(quoteReplay.value.quoteId).toBe(quote.value.quoteId);
    await env.DB.prepare(
      "UPDATE global_fulfillment_mode SET active_mode='INSTANT',cadence=NULL,version=version+1 WHERE id='global'",
    ).run();
    const replayAfterRoutingChanged = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      fulfillmentOptionId: scheduledOption.optionId,
      cartVersion: cartNow.value.version,
      idempotencyKey: quoteKey,
    });
    expect(replayAfterRoutingChanged).toMatchObject({
      ok: true,
      value: { quoteId: quote.value.quoteId },
    });
    const conflictingQuoteReplay = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      fulfillmentOptionId: `${scheduledOption.optionId}-different`,
      cartVersion: cartNow.value.version,
      idempotencyKey: quoteKey,
    });
    expect(conflictingQuoteReplay).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    await env.DB.prepare(
      "UPDATE global_fulfillment_mode SET active_mode='SCHEDULED',cadence='WEEKLY',version=version+1 WHERE id='global'",
    ).run();
    await env.DB.prepare(
      "UPDATE price_version SET amount_minor=amount_minor+100 WHERE sku_id='sku-red-onion-500g' AND valid_to IS NULL",
    ).run();
    const changed = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: quote.value.quoteId,
      ...acceptedPrice(quote.value),
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: `flow-rejected-${crypto.randomUUID()}`,
    });
    expect(changed).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
    const intentsBeforeAcceptance = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_intent",
    ).first<{ count: number }>();
    expect(intentsBeforeAcceptance?.count).toBe(0);

    const refreshedOptions = await core.listFulfillmentOptions({
      ...request(),
      addressId: address.value.id,
      addressVersion: address.value.version,
      cartId: cart.value.id,
      cartVersion: cartNow.value.version,
    });
    if (!refreshedOptions.ok) throw new Error("refreshed fulfillment options unavailable");
    const refreshedScheduledOption = refreshedOptions.value.find(
      (option) => option.mode === "SCHEDULED" && option.eligible,
    );
    if (!refreshedScheduledOption) throw new Error("refreshed Scheduled option unavailable");

    const acceptedQuote = await core.createCheckoutQuote({
      headers,
      requestId: requestId(),
      addressId: address.value.id,
      cartId: cart.value.id,
      fulfillmentOptionId: refreshedScheduledOption.optionId,
      cartVersion: cartNow.value.version,
      idempotencyKey: `flow-accepted-${crypto.randomUUID()}`,
    });
    expect(acceptedQuote.ok).toBe(true);
    if (!acceptedQuote.ok) return;
    expect(acceptedQuote.value.totalMinor).toBeGreaterThan(quote.value.totalMinor);
    const quotesBeforePayment = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_quote WHERE cart_id=?",
    )
      .bind(cart.value.id)
      .first<{ count: number }>();

    const paymentKey = `flow-payment-${crypto.randomUUID()}`;
    const staleAcceptance = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      ...acceptedPrice(acceptedQuote.value),
      expectedQuoteVersion: acceptedQuote.value.attemptVersion + 1,
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: `flow-stale-${crypto.randomUUID()}`,
    });
    const partialAcceptance = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      ...acceptedPrice(acceptedQuote.value),
      expectedOrderDiscountMinor: acceptedQuote.value.orderDiscountMinor + 1,
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: `flow-partial-${crypto.randomUUID()}`,
    });
    expect(staleAcceptance).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
    expect(partialAcceptance).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });

    const payment = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      ...acceptedPrice(acceptedQuote.value),
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: paymentKey,
    });
    expect(payment).toMatchObject({
      ok: true,
      value: { state: "REQUIRES_ACTION", actionType: "REDIRECT" },
    });
    if (!payment.ok) return;
    const paymentSubject = await env.DB.prepare(
      "SELECT subject_id, customer_id FROM payment_intent WHERE id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ subject_id: string; customer_id: string }>();
    const quotesAfterPayment = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_quote WHERE cart_id=?",
    )
      .bind(cart.value.id)
      .first<{ count: number }>();
    expect(paymentSubject?.subject_id).toBe(acceptedQuote.value.quoteId);
    expect(quotesAfterPayment?.count).toBe(quotesBeforePayment?.count);

    const beforeProviderEvent = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM grocery_order WHERE customer_id=?",
    )
      .bind(paymentSubject!.customer_id)
      .first<{ count: number }>();
    expect(beforeProviderEvent?.count).toBe(0);
    const paymentAttempt = await env.DB.prepare(
      "SELECT provider_reference FROM payment_attempt WHERE payment_intent_id=?",
    )
      .bind(payment.value.paymentIntentId)
      .first<{ provider_reference: string }>();
    const simulationCommand = {
      environment: "test" as const,
      customerId: paymentSubject!.customer_id,
      providerReference: paymentAttempt!.provider_reference,
      outcome: "SUCCEEDED" as const,
      idempotencyKey: `flow-simulator-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    };
    const firstSimulation = await simulateMockProviderEvent(
      env.DB,
      buildProviderRegistry({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" }),
      simulationCommand,
    );
    expect(firstSimulation).toMatchObject({
      ok: true,
      value: { committedOrderId: expect.any(String) },
    });
    const replaySimulation = await simulateMockProviderEvent(
      env.DB,
      buildProviderRegistry({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" }),
      simulationCommand,
    );
    expect(replaySimulation).toEqual(firstSimulation);

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

    // A lost browser response can be replayed after commitment consumed the
    // quote. Replay must resolve by payment identity before quote validity.
    const paymentReplay = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      ...acceptedPrice(acceptedQuote.value),
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: paymentKey,
    });
    expect(paymentReplay).toMatchObject({
      ok: true,
      value: { paymentIntentId: payment.value.paymentIntentId },
    });
    const conflictingReplay = await core.createPaymentIntent({
      headers,
      requestId: requestId(),
      checkoutAttemptId: acceptedQuote.value.quoteId,
      ...acceptedPrice(acceptedQuote.value),
      expectedDeliveryDiscountMinor: acceptedQuote.value.deliveryDiscountMinor + 1,
      returnUrl: "https://freshmarkets.example.invalid/orders",
      idempotencyKey: paymentKey,
    });
    expect(conflictingReplay).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    const quotesAfterReplay = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM checkout_quote WHERE cart_id=?",
    )
      .bind(cart.value.id)
      .first<{ count: number }>();
    expect(quotesAfterReplay?.count).toBe(quotesBeforePayment?.count);
  }, 15_000);
});
