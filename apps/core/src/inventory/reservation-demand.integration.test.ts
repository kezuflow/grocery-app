import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
const password = "correct-horse-battery-staple";
const locationId = "location-cebu-central";
const poolId = "pool-red-onion";

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
  const email = `resdem-${crypto.randomUUID()}@example.com`;
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Reservation Demand", email, password }),
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

async function checkoutFixture(quantity: number) {
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
    recipient: "Reservation Demand",
    phone: "09000000000",
    addressJson: JSON.stringify({ line1: "Cebu City" }),
    latitude: 10.32,
    longitude: 123.9,
  });
  expect(address.ok).toBe(true);
  const cart = await core.getCart(request());
  expect(cart.ok).toBe(true);
  const item = await core.setCartItem({ ...request(), skuId: "sku-red-onion-500g", quantity });
  expect(item.ok).toBe(true);
  const cycles = await core.listDeliveryCycles({ requestId: requestId() });
  expect(cycles.ok).toBe(true);
  if (!address.ok || !cart.ok || !cycles.ok || cycles.value.length === 0)
    throw new Error("fixture incomplete");
  return {
    headers,
    addressId: address.value.id,
    cartId: cart.value.id,
    cycleId: cycles.value[0].id,
  };
}

async function setSourcingMode(mode: "STOCKED" | "PLANNED_PROCUREMENT" | "HYBRID") {
  await env.DB.prepare("UPDATE inventory_pool SET sourcing_mode=? WHERE id=?")
    .bind(mode, poolId)
    .run();
}

async function setBalance(onHand: number, reserved = 0) {
  await env.DB.prepare(
    "UPDATE inventory_balance SET on_hand=?, reserved=?, version=version+1 WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(onHand, reserved, locationId, poolId)
    .run();
}

async function readBalance() {
  return env.DB.prepare(
    "SELECT on_hand, reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(locationId, poolId)
    .first<{ on_hand: number; reserved: number }>();
}

async function holdLedgerSum() {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(reservation_delta_base),0) AS total FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='CHECKOUT_HOLD'",
  )
    .bind(locationId, poolId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function commit(fixture: Awaited<ReturnType<typeof checkoutFixture>>) {
  // Canonical path: authoritative quote, then the commitment reaction applied
  // directly (the deterministic mock provider is test-registry-only).
  const cartNow = await core.getCart({ headers: fixture.headers, requestId: requestId() });
  if (!cartNow.ok) throw new Error("cart unavailable");
  const quote = await core.createCheckoutQuote({
    headers: fixture.headers,
    requestId: requestId(),
    cartId: fixture.cartId,
    cartVersion: cartNow.value.version,
    addressId: fixture.addressId,
    deliveryCycleId: fixture.cycleId,
    idempotencyKey: `resdem-${crypto.randomUUID()}`,
  });
  if (!quote.ok) throw new Error(JSON.stringify(quote.error));
  const intentId = crypto.randomUUID();
  const customerIdRow = await env.DB.prepare("SELECT customer_id FROM checkout_quote WHERE id=?")
    .bind(quote.value.quoteId)
    .first<{ customer_id: string }>();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, ?, ?, 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(
      intentId,
      quote.value.quoteId,
      customerIdRow!.customer_id,
      quote.value.totalMinor,
      quote.value.currency,
      `pi-${intentId}`,
      Date.now(),
      Date.now(),
    )
    .run();
  const attemptId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, provider_reference, idempotency_key, created_at, updated_at, version, payment_intent_id) VALUES (?, ?, ?, ?, 'SUCCEEDED', 'mock', ?, ?, ?, ?, 1, ?)",
  )
    .bind(
      attemptId,
      customerIdRow!.customer_id,
      quote.value.totalMinor,
      quote.value.currency,
      `mock_pay_${attemptId}`,
      `attempt-${attemptId}`,
      Date.now(),
      Date.now(),
      intentId,
    )
    .run();
  const reactionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, 'COMMIT_ORDER', 'checkout_quote', ?, 'PENDING', ?, 0, ?, ?)",
  )
    .bind(reactionId, intentId, quote.value.quoteId, `reaction:${intentId}`, Date.now(), Date.now())
    .run();
  const { applyCheckoutPaymentReaction } =
    await import("../orders/application/apply-checkout-payment-reaction");
  const outcome = await applyCheckoutPaymentReaction(env.DB, {
    reactionId,
    paymentIntentId: intentId,
    checkoutAttemptId: quote.value.quoteId,
    canonicalPaymentState: "SUCCEEDED",
  });
  if (!outcome.applied || !outcome.orderId) throw new Error(`commitment failed: ${outcome.reason}`);
  return { ok: true as const, value: { orderId: outcome.orderId } };
}

describe("reservation and committed-demand separation", () => {
  it("creates a reservation only for stocked sourcing", async () => {
    await setSourcingMode("STOCKED");
    await setBalance(100_000);
    try {
      const fixture = await checkoutFixture(4);
      const committed = await commit(fixture);
      expect(committed.ok).toBe(true);
      const orderId = (committed as { value: { orderId: string } }).value.orderId;
      const reservations = await env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ total: number }>();
      const demand = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM committed_demand WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ count: number }>();
      expect(reservations?.total).toBe(2000);
      expect(demand?.count).toBe(0);
    } finally {
      await setSourcingMode("HYBRID");
    }
  });

  it("creates committed demand only for planned procurement", async () => {
    await setSourcingMode("PLANNED_PROCUREMENT");
    try {
      const fixture = await checkoutFixture(4);
      const committed = await commit(fixture);
      expect(committed.ok).toBe(true);
      const orderId = (committed as { value: { orderId: string } }).value.orderId;
      const demand = await env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM committed_demand WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ total: number }>();
      const reservations = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ count: number }>();
      expect(demand?.total).toBe(2000);
      expect(reservations?.count).toBe(0);
    } finally {
      await setSourcingMode("HYBRID");
    }
  });

  it("splits hybrid sourcing into disjoint exact quantities that reconcile", async () => {
    await setSourcingMode("HYBRID");
    await setBalance(1500);
    const ledgerBefore = await holdLedgerSum();
    const fixture = await checkoutFixture(4);
    const committed = await commit(fixture);
    expect(committed.ok).toBe(true);
    const orderId = (committed as { value: { orderId: string } }).value.orderId;
    const [reservation, demand] = await Promise.all([
      env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ total: number }>(),
      env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total FROM committed_demand WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ total: number }>(),
    ]);
    expect((reservation?.total ?? 0) + (demand?.total ?? 0)).toBe(2000);
    const balance = await readBalance();
    expect(balance?.reserved ?? 0).toBeLessThanOrEqual(balance?.on_hand ?? 0);
    expect(await holdLedgerSum()).toBeGreaterThan(ledgerBefore);
  });

  it("never reserves beyond usable stock under concurrent canonical commitments", async () => {
    await setSourcingMode("STOCKED");
    await setBalance(3000);
    try {
      const [fixtureA, fixtureB] = await Promise.all([checkoutFixture(4), checkoutFixture(4)]);
      const results = await Promise.allSettled([commit(fixtureA), commit(fixtureB)]);
      const fulfilled = results.filter((result) => result.status === "fulfilled").length;
      expect(fulfilled).toBe(1);
      const balance = await readBalance();
      expect(balance?.reserved ?? 0).toBeLessThanOrEqual(balance?.on_hand ?? 0);
      expect(balance?.reserved ?? 0).toBe(2000);
    } finally {
      await setSourcingMode("HYBRID");
    }
  });
});
