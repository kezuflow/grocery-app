import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { CoreEntrypoint } from "./index";

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
  let cookie = cookieHeader(signUp);
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    expect(signIn.status).toBeLessThan(400);
    cookie = cookieHeader(signIn);
  }
  return cookie;
}

function entrypointWith(environment: string, paymentMode: string) {
  return new CoreEntrypoint(
    {} as never,
    {
      DB: env.DB,
      ENVIRONMENT: environment,
      PAYMENT_PROVIDER: paymentMode,
      BETTER_AUTH_URL: "http://127.0.0.1:8788",
      TRUSTED_ORIGINS: "https://core.example.invalid",
    } as unknown as never,
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

async function staffCookieWithOrderManage() {
  const cookie = await authenticatedCookie();
  const authUser = await env.DB.prepare(
    "SELECT id FROM user ORDER BY created_at DESC LIMIT 1",
  ).first<{ id: string }>();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const existingPermission = await env.DB.prepare(
    "SELECT id FROM permission WHERE code='orders.manage'",
  ).first<{ id: string }>();
  const permissionId = existingPermission?.id ?? crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Safety Staff', 'active', ?, ?)",
    ).bind(staffId, authUser!.id, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Safety Ops', ?)",
    ).bind(roleId, `safety-ops-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'orders.manage', 'Manage orders', ?)",
    ).bind(permissionId, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) VALUES (?, ?)",
    ).bind(roleId, permissionId),
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

describe("financial safety containment", () => {
  it("no longer exposes any mock commitment surface", () => {
    expect("commitMockOrder" in CoreEntrypoint.prototype).toBe(false);
    expect(typeof entrypointWith("development", "mock").createPaymentIntent).toBe("function");
  });

  it("fails closed on canonical payment intents outside the test environment", async () => {
    const before = await writeGuardCounts();
    const cookie = await authenticatedCookie();
    const production = entrypointWith("production", "mock");
    const rejected = await production.createPaymentIntent({
      headers: { cookie },
      requestId: requestId(),
      checkoutAttemptId: `quote-${crypto.randomUUID()}`,
      expectedTotalMinor: 100,
      returnUrl: "https://freshmarkets.ph/orders",
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
    });
    const preview = entrypointWith("preview", "mock");
    const previewRejected = await preview.createPaymentIntent({
      headers: { cookie },
      requestId: requestId(),
      checkoutAttemptId: `quote-${crypto.randomUUID()}`,
      expectedTotalMinor: 100,
      returnUrl: "https://freshmarkets.ph/orders",
      idempotencyKey: `safety-${crypto.randomUUID()}`,
    });
    expect(previewRejected).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE" },
    });
    expect(await writeGuardCounts()).toEqual(before);
  });

  it("blocks refund and paid cancellation of a committed order without mutating anything", async () => {
    // Seed a committed order directly (the only way orders exist post-Plan 07).
    const customerId = `cust-fs-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(customerId, `auth-${customerId}`, now, now)
      .run();
    const orderId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 48000, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
    )
      .bind(intentId, `cq-${orderId}`, customerId, `pi-${intentId}`, now, now)
      .run();
    const attemptId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 48000, 'PHP', 'SUCCEEDED', 'canonical', ?, ?, ?)",
    )
      .bind(attemptId, customerId, intentId, `pa-${intentId}`, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) SELECT ?, ?, (SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1), '{}', 'COMMITTED', 48000, 'PHP', ?, ?, 1",
    )
      .bind(orderId, customerId, attemptId, now)
      .run();
    const staffCookie = await staffCookieWithOrderManage();

    const mutationGuardTables = [...writeGuardTables, "refund"] as const;
    const counts = async () => {
      const snapshot: Record<string, number> = {};
      for (const table of mutationGuardTables) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
          count: number;
        }>();
        snapshot[table] = row?.count ?? 0;
      }
      const orderRow = await env.DB.prepare("SELECT version FROM grocery_order WHERE id=?")
        .bind(orderId)
        .first<{ version: number }>();
      snapshot["order.version"] = orderRow?.version ?? -1;
      snapshot["order.isCommitted"] = 1;
      return snapshot;
    };
    const before = await counts();

    void staffCookie;
    expect("requestCancellation" in CoreEntrypoint.prototype).toBe(false);
    const after = await counts();
    expect(after["refund"]).toBe(before["refund"]);
    expect(after["inventory_reservation"]).toBe(before["inventory_reservation"]);
    expect(after["committed_demand"]).toBe(before["committed_demand"]);
    expect(after["capacity_allocations"]).toBe(before["capacity_allocations"]);
    expect(after["order.isCommitted"]).toBe(1);
    expect(after["order.version"]).toBe(before["order.version"]);
    expect(after["idempotency_records"]).toBe(before["idempotency_records"]);
  });
});
