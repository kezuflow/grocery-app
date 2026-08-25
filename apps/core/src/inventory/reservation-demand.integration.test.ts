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
  return core.commitMockOrder({
    headers: fixture.headers,
    requestId: requestId(),
    addressId: fixture.addressId,
    cartId: fixture.cartId,
    cycleId: fixture.cycleId,
    idempotencyKey: `resdem-${crypto.randomUUID()}`,
  });
}

describe("reservation and committed-demand separation", () => {
  it("creates a reservation only for stocked sourcing", async () => {
    await setSourcingMode("STOCKED");
    await setBalance(100_000);
    try {
      const fixture = await checkoutFixture(4);
      const committed = await commit(fixture);
      expect(committed).toMatchObject({ ok: true, value: { orderStatus: "COMMITTED" } });
      if (!committed.ok) return;
      const orderId = committed.value.orderId;
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
      // 4 x 500g SKUs consume 2000 GRAM from the shared product pool.
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
      expect(committed).toMatchObject({ ok: true, value: { orderStatus: "COMMITTED" } });
      if (!committed.ok) return;
      const orderId = committed.value.orderId;
      const demand = await env.DB.prepare(
        "SELECT COALESCE(SUM(quantity),0) AS total, MAX(status) AS status FROM committed_demand WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ total: number; status: string }>();
      const reservations = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM inventory_reservation WHERE order_id=? AND inventory_pool_id=?",
      )
        .bind(orderId, poolId)
        .first<{ count: number }>();
      expect(demand?.total).toBe(2000);
      expect(demand?.status).toBe("OPEN");
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
    expect(committed).toMatchObject({ ok: true, value: { orderStatus: "COMMITTED" } });
    if (!committed.ok) return;
    const orderId = committed.value.orderId;
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
    expect(reservation?.total ?? 0).toBe(1500);
    expect(demand?.total ?? 0).toBe(500);
    expect((reservation?.total ?? 0) + (demand?.total ?? 0)).toBe(2000);
    const balance = await readBalance();
    expect(balance?.reserved ?? 0).toBeLessThanOrEqual(balance?.on_hand ?? 0);
    expect(await holdLedgerSum()).toBe(ledgerBefore + 1500);
  });

  it("never reserves beyond usable stock under concurrent commitment", async () => {
    await setSourcingMode("STOCKED");
    await setBalance(3000);
    try {
      const [fixtureA, fixtureB] = await Promise.all([checkoutFixture(4), checkoutFixture(4)]);
      const [resultA, resultB] = await Promise.all([commit(fixtureA), commit(fixtureB)]);
      const successes = [resultA, resultB].filter((result) => result.ok).length;
      expect(successes).toBe(1);
      const failures = [resultA, resultB].filter((result) => !result.ok);
      for (const failure of failures) expect(failure.error.code).toBe("INSUFFICIENT_STOCK");
      const balance = await readBalance();
      expect(balance?.reserved ?? 0).toBeLessThanOrEqual(balance?.on_hand ?? 0);
      expect(balance?.reserved ?? 0).toBe(2000);
    } finally {
      await setSourcingMode("HYBRID");
    }
  });

  it("keeps hold ledger evidence reconciled with reserved balances", async () => {
    await setSourcingMode("STOCKED");
    await setBalance(10_000);
    try {
      const ledgerBefore = await holdLedgerSum();
      const fixture = await checkoutFixture(4);
      const committed = await commit(fixture);
      expect(committed).toMatchObject({ ok: true });
      const balance = await readBalance();
      expect(await holdLedgerSum()).toBe(ledgerBefore + (balance?.reserved ?? 0));
    } finally {
      await setSourcingMode("HYBRID");
    }
  });
});
