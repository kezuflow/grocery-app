import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { CoreEntrypoint } from "./index";

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
  if (cookie) return { cookie, userId: body.user!.id };
  const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ email, password }),
  });
  expect(signIn.status).toBeLessThan(400);
  const authUser = await env.DB.prepare("SELECT id FROM user WHERE email=?")
    .bind(email)
    .first<{ id: string }>();
  return { cookie: cookieHeader(signIn), userId: authUser!.id };
}

async function staffCookieWithOrderManage() {
  const { cookie, userId } = await authenticatedCookie();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const existingPermission = await env.DB.prepare(
    "SELECT id FROM permission WHERE code='order:manage'",
  ).first<{ id: string }>();
  const permissionId = existingPermission?.id ?? crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Safety Staff', 'active', ?, ?)",
    ).bind(staffId, userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, 'safety-ops', 'Safety Ops', ?)",
    ).bind(roleId, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'order:manage', 'Manage orders', ?)",
    ).bind(permissionId, now),
    env.DB.prepare("INSERT INTO role_permission (role_id, permission_id) VALUES (?, ?)").bind(
      roleId,
      permissionId,
    ),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'global', NULL, NULL)",
    ).bind(crypto.randomUUID(), staffId),
  ]);
  return cookie;
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
  const { cookie } = await authenticatedCookie();
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

  it("blocks refund and paid cancellation of a committed order without mutating anything", async () => {
    const fixture = await checkoutFixture();
    const sandbox = entrypointWith("development", "sandbox");
    const committed = await sandbox.commitMockOrder({
      headers: fixture.headers,
      requestId: requestId(),
      addressId: fixture.addressId,
      cartId: fixture.cartId,
      cycleId: fixture.cycleId,
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(committed).toMatchObject({ ok: true, value: { orderStatus: "COMMITTED" } });
    if (!committed.ok) return;
    const staffCookie = await staffCookieWithOrderManage();

    const mutationGuardTables = [...writeGuardTables, "refund", "inventory_balance"] as const;
    const counts = async () => {
      const snapshot: Record<string, number> = {};
      for (const table of mutationGuardTables) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
          count: number;
        }>();
        snapshot[table] = row?.count ?? 0;
      }
      const order = await env.DB.prepare("SELECT status, version FROM grocery_order WHERE id=?")
        .bind(committed.value.orderId)
        .first<{ status: string; version: number }>();
      snapshot["grocery_order.committed"] = order ? 1 : 0;
      snapshot["grocery_order.version"] = order?.version ?? -1;
      snapshot["grocery_order.status_code"] = order ? (ORDER_STATUS_CODES[order.status] ?? -1) : -1;
      return snapshot;
    };
    const before = await counts();

    for (const action of ["REFUND", "CANCEL"] as const) {
      const rejected = await core.advanceOrder({
        headers: { cookie: staffCookie },
        requestId: requestId(),
        orderId: committed.value.orderId,
        action,
        reason: `safety-${action.toLowerCase()}`,
        idempotencyKey: `safety-${crypto.randomUUID()}`,
        expectedVersion: 0,
      });
      expect(rejected).toMatchObject({
        ok: false,
        error: { code: "FINANCIAL_OPERATION_REQUIRES_REVIEW" },
      });
    }
    expect(await counts()).toEqual(before);
  });
});

const ORDER_STATUS_CODES: Record<string, number> = {
  COMMITTED: 1,
  IN_FULFILLMENT: 2,
  PACKED: 3,
  DISPATCHED: 4,
  DELIVERED: 5,
  DELIVERY_FAILED: 6,
  CANCELED: 7,
  REFUNDED: 8,
};
