import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { CoreEntrypoint } from "./index";
import type { Env } from "./worker-configuration";

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
  const email = `safety-${crypto.randomUUID()}@example.com`;
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Safety Test", email, password }),
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

function entrypointWith(environment: string, paymentMode: string) {
  return new CoreEntrypoint(
    {} as never,
    {
      DB: env.DB,
      ENVIRONMENT: environment,
      PAYMENT_MODE: paymentMode,
      BETTER_AUTH_URL: "http://127.0.0.1:8788",
      TRUSTED_ORIGINS: "https://core.example.invalid",
    } as unknown as Env,
  );
}

const writeGuardTables = [
  "payment_attempt",
  "payment_events",
  "grocery_order",
  "idempotency_records",
  "capacity_allocations",
  "inventory_reservation",
  "committed_demand",
  "checkout_inventory_holds",
  "checkout_attempts",
  "inventory_ledger_entries",
  "audit_event",
] as const;

async function writeGuardCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of writeGuardTables) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
      count: number;
    }>();
    counts[table] = row?.count ?? 0;
  }
  return counts;
}

async function checkoutFixture() {
  const cookie = await authenticatedCookie();
  const headers = { cookie };
  const request = () => ({ headers, requestId: requestId() });
  const trial = await core.startTrial(request());
  expect(trial.ok).toBe(true);
  const address = await core.createCustomerAddress({
    ...request(),
    label: "Home",
    recipient: "Safety Test",
    phone: "09000000000",
    addressJson: JSON.stringify({ line1: "Cebu City" }),
    latitude: 10.32,
    longitude: 123.9,
  });
  expect(address.ok).toBe(true);
  const cart = await core.getCart(request());
  expect(cart.ok).toBe(true);
  const item = await core.setCartItem({
    ...request(),
    skuId: "sku-red-onion-500g",
    quantity: 4,
  });
  expect(item.ok).toBe(true);
  const cycles = await core.listDeliveryCycles({ requestId: requestId() });
  expect(cycles.ok).toBe(true);
  if (!address.ok || !cart.ok || !cycles.ok || cycles.value.length === 0)
    throw new Error("checkout fixture incomplete");
  return {
    headers,
    addressId: address.value.id,
    cartId: cart.value.id,
    cycleId: cycles.value[0].id,
  };
}

describe("financial safety containment", () => {
  it("rejects mock commitment in production before any write, while the sandbox still commits", async () => {
    const sandboxFixture = await checkoutFixture();
    const sandbox = entrypointWith("development", "sandbox");
    const sandboxCommit = await sandbox.commitMockOrder({
      headers: sandboxFixture.headers,
      requestId: requestId(),
      addressId: sandboxFixture.addressId,
      cartId: sandboxFixture.cartId,
      cycleId: sandboxFixture.cycleId,
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(sandboxCommit).toMatchObject({ ok: true, value: { orderStatus: "COMMITTED" } });

    const productionFixture = await checkoutFixture();
    const before = await writeGuardCounts();
    const production = entrypointWith("production", "sandbox");
    const rejected = await production.commitMockOrder({
      headers: productionFixture.headers,
      requestId: requestId(),
      addressId: productionFixture.addressId,
      cartId: productionFixture.cartId,
      cycleId: productionFixture.cycleId,
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
    });
    expect(await writeGuardCounts()).toEqual(before);
  });

  it("rejects mock commitment in preview even when sandbox mode is requested", async () => {
    const preview = entrypointWith("preview", "sandbox");
    const before = await writeGuardCounts();
    const rejected = await preview.commitMockOrder({
      headers: {},
      requestId: requestId(),
      addressId: "any",
      cartId: "any",
      cycleId: "any",
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
    });
    expect(await writeGuardCounts()).toEqual(before);
  });
});
