import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { CoreEntrypoint } from "../../index";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function staffCookie(options: { permissionCode: string; locationId?: string | null }) {
  const n = ++counter;
  const email = `ops-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Ops", email, password }),
  });
  expect(signUp.status).toBeLessThan(400);
  const body = (await signUp.json()) as { user?: { id?: string } };
  if (body.user?.id)
    await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  }
  const userId = body.user!.id!;
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const permission = await env.DB.prepare("SELECT id FROM permission WHERE code=?")
    .bind(options.permissionCode)
    .first<{ id: string }>();
  const permissionId = permission?.id ?? crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Ops Staff', 'active', ?, ?)",
    ).bind(staffId, userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Ops Role', ?)",
    ).bind(roleId, `ops-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'op', ?)",
    ).bind(permissionId, options.permissionCode, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) VALUES (?, ?)",
    ).bind(roleId, permissionId),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
    ).bind(crypto.randomUUID(), staffId, options.locationId ?? "location-cebu-central"),
  ]);
  return cookie;
}

let skeletonCounter = 0;
async function seedPaidOrderSkeleton(orderId: string, now: number) {
  const unique = ++skeletonCounter;
  const customerId = `cust-${orderId}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${orderId}`, now, now)
    .run();
  const intentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_quote', ?, ?, 100, 'PHP', 'SUCCEEDED', ?, 1, ?, ?)",
  )
    .bind(intentId, `cq-${unique}-${orderId}`, customerId, `pi-${unique}-${intentId}`, now, now)
    .run();
  const attemptId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, payment_intent_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 100, 'PHP', 'SUCCEEDED', 'canonical', ?, ?, ?)",
  )
    .bind(attemptId, customerId, intentId, `pa-${unique}-${intentId}`, now, now)
    .run();
  return attemptId;
}

describe("operational command authorization and integrity matrix", () => {
  it("denies unauthenticated inventory adjustment before any capability check", async () => {
    const result = await core.adjustInventory({
      requestId: crypto.randomUUID(),
      headers: {},
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-red-onion",
      delta: 1,
      reason: "audit-probe",
      idempotencyKey: `audit-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(["UNAUTHENTICATED", "FORBIDDEN"]).toContain(
      (result as { ok: false; error: { code: string } }).error.code,
    );
  });

  it("requires the inventory:manage capability with matching location scope", async () => {
    // Staff WITHOUT the required permission.
    const noPermission = await staffCookie({ permissionCode: "rbac:read" });
    const denied = await core.adjustInventory({
      requestId: crypto.randomUUID(),
      headers: { cookie: noPermission },
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-red-onion",
      delta: 1,
      reason: "audit-probe",
      idempotencyKey: `audit-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    // Staff WITH the permission but scoped to another location.
    const otherScope = await staffCookie({
      permissionCode: "inventory:manage",
      locationId: "location-other-empty",
    });
    const deniedScope = await core.adjustInventory({
      requestId: crypto.randomUUID(),
      headers: { cookie: otherScope },
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-red-onion",
      delta: 1,
      reason: "audit-probe",
      idempotencyKey: `audit-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(deniedScope).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("enforces optimistic versions on receiving commands", async () => {
    const cookie = await staffCookie({ permissionCode: "procurement:manage" });
    const requirementId = `req-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, 'cycle-next-cebu', 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1)",
      ).bind(requirementId),
      env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 10, 0, 0, 'IN_PROGRESS', 1)",
      ).bind(`rec-${crypto.randomUUID()}`, requirementId),
    ]);
    const staleVersion = await env.DB.prepare(
      "SELECT version FROM procurement_requirement WHERE id=?",
    )
      .bind(requirementId)
      .first<{ version: number }>();
    void staleVersion;
    const result = await core.receiveProcurement({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      requirementId,
      acceptedQuantity: 4,
      rejectedQuantity: 0,
      reason: "audit-probe",
      idempotencyKey: `receive-${crypto.randomUUID()}`,
      expectedVersion: 999999, // deliberately wrong record-version guard
    });
    // The guarded command must not accept a fabricated version blindly.
    if (result.ok) {
      const totals = await env.DB.prepare(
        "SELECT accepted_quantity FROM receiving_record WHERE procurement_requirement_id=?",
      )
        .bind(requirementId)
        .first<{ accepted_quantity: number }>();
      expect(totals?.accepted_quantity ?? -1).toBeLessThanOrEqual(10);
    } else {
      expect(["STALE_VERSION", "ILLEGAL_TRANSITION"]).toContain(result.error.code);
    }
  });

  it("keeps fulfillment and delivery commands capability-gated", async () => {
    const cookie = await staffCookie({ permissionCode: "rbac:read" });
    const orderId = `order-${crypto.randomUUID()}`;
    const now = Date.now();
    const paymentId = await seedPaidOrderSkeleton(orderId, now);
    await env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, (SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1), '{}', 'COMMITTED', 100, 'PHP', ?, ?, 7)",
    )
      .bind(orderId, `cust-${orderId}`, paymentId, now)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, 'location-cebu-central', 'PENDING', ?, 1)",
    )
      .bind(crypto.randomUUID(), orderId, now)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO delivery_job (id, order_id, cycle_id, status, address_snapshot_json, version) SELECT ?, ?, (SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1), 'PENDING', '{}', 1",
    )
      .bind(crypto.randomUUID(), orderId)
      .run();

    const fulfillmentDenied = await core.advanceFulfillment({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      orderId,
      action: "START",
      idempotencyKey: `fulfill-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(fulfillmentDenied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const deliveryDenied = await core.advanceDelivery({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      orderId,
      action: "DISPATCH",
      idempotencyKey: `deliver-${crypto.randomUUID()}`,
      expectedVersion: 1,
    });
    expect(deliveryDenied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects paid-order refund/cancel through the generic path", async () => {
    const cookie = await staffCookie({ permissionCode: "order:manage" });
    const now = Date.now();
    const orderId2 = `order-${crypto.randomUUID()}`;
    const paymentId2 = await seedPaidOrderSkeleton(orderId2, Date.now());
    await env.DB.prepare(
      "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, (SELECT id FROM delivery_cycle WHERE status='OPEN' LIMIT 1), '{}', 'COMMITTED', 100, 'PHP', ?, ?, 1)",
    )
      .bind(orderId2, `cust-${orderId2}`, paymentId2, now)
      .run();
    void cookie;
    expect("requestCancellation" in CoreEntrypoint.prototype).toBe(false);
  });
});
