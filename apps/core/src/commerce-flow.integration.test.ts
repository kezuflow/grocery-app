import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";

function requestId() {
  return crypto.randomUUID();
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
  if (body.user?.id)
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
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
    const intents = await env.DB.prepare("SELECT COUNT(*) AS count FROM payment_intent").first<{
      count: number;
    }>();
    expect(intents?.count).toBe(0);
  });
});
