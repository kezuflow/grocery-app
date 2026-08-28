import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

async function manager(capabilities: string[]) {
  const email = `ops-command-${crypto.randomUUID()}@example.com`;
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Operations", email, password: "correct-horse-battery-staple" }),
  });
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  const now = Date.now(),
    staffId = crypto.randomUUID(),
    roleId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Ops', 'active', ?, ?)",
    ).bind(staffId, body.user.id, now, now),
    env.DB.prepare("INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Ops', ?)").bind(
      roleId,
      `ops-command-${crypto.randomUUID()}`,
      now,
    ),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, 'location-cebu-central')",
    ).bind(crypto.randomUUID(), staffId),
  ];
  for (const capability of capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'ops', ?)",
      ).bind(crypto.randomUUID(), capability, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return { cookie, userId: body.user.id };
}

describe("admin operations commands", () => {
  it("requires authentication and validates mode CAS input", async () => {
    expect(
      await core.aggregateAdminProcurementDemand({
        requestId: "none",
        headers: {},
        locationId: "location-cebu-central",
        cycleId: "cycle",
        inventoryPoolId: "pool-red-onion",
        expectedVersion: 0,
        idempotencyKey: "aggregate-none",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const { cookie } = await manager(["fulfillment.manage"]);
    expect(
      await core.activateFulfillmentMode({
        requestId: crypto.randomUUID(),
        headers: { cookie },
        locationId: "location-cebu-central",
        fulfillmentMode: "INSTANT",
        cadence: "WEEKLY",
        expectedVersion: null,
        idempotencyKey: `mode-${crypto.randomUUID()}`,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("records accepted/rejected base-unit deltas through the guarded receiving command", async () => {
    const { cookie } = await manager(["procurement.manage"]),
      id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, 'cycle-ops', 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1)",
      ).bind(id),
      env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 10, 0, 0, 'IN_PROGRESS', 1)",
      ).bind(`receipt-${id}`, id),
    ]);
    const lineKey = `line-${crypto.randomUUID()}`;
    const lineInput = {
      requestId: crypto.randomUUID(),
      headers: { cookie },
      locationId: "location-cebu-central",
      receivingSessionId: `receipt-${id}`,
      acceptedBase: 7,
      rejectedBase: 3,
      expectedVersion: 1,
      idempotencyKey: lineKey,
      reason: "quality rejection",
    };
    const recorded = await core.recordAdminReceivedLine(lineInput);
    expect(recorded).toMatchObject({ ok: true, value: { acceptedBase: 7, rejectedBase: 3 } });
    expect(
      await core.recordAdminReceivedLine({ ...lineInput, requestId: crypto.randomUUID() }),
    ).toMatchObject({ ok: true });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='OPERATIONS.RECEIVING_LINE_RECORDED' AND idempotency_key=?",
    )
      .bind(lineKey)
      .first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });

  it("derives procurement from committed demand and replays without a second audit", async () => {
    const principal = await manager(["procurement.manage"]);
    const { cookie } = principal;
    const customerPrincipal = await env.DB.prepare(
      "SELECT id FROM customer_principal WHERE auth_user_id=?",
    )
      .bind(principal.userId)
      .first<{ id: string }>();
    expect(customerPrincipal).toBeTruthy();
    if (!customerPrincipal) return;
    const customer = { id: crypto.randomUUID() };
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    )
      .bind(customer.id, principal.userId, customerPrincipal.id, Date.now(), Date.now())
      .run();
    const orderId = crypto.randomUUID(),
      paymentId = crypto.randomUUID(),
      cycleId = "cycle-next-cebu",
      key = `aggregate-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE inventory_balance SET on_hand=0, reserved=0 WHERE location_id='location-cebu-central' AND inventory_pool_id='pool-red-onion'",
      ),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 1, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
      ).bind(paymentId, customer.id, `payment-${crypto.randomUUID()}`, Date.now(), Date.now()),
      env.DB.prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, ?, '{}', 'COMMITTED', 1, 'PHP', ?, ?, 1)",
      ).bind(orderId, customer.id, cycleId, paymentId, Date.now()),
      env.DB.prepare(
        "INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status, version) VALUES (?, ?, ?, 'location-cebu-central', 'pool-red-onion', 9, 'OPEN', 1)",
      ).bind(crypto.randomUUID(), orderId, cycleId),
    ]);
    const input = {
      requestId: crypto.randomUUID(),
      headers: { cookie },
      locationId: "location-cebu-central",
      cycleId,
      inventoryPoolId: "pool-red-onion",
      expectedVersion: 0,
      idempotencyKey: key,
      reason: "cutoff",
    };
    const first = await core.aggregateAdminProcurementDemand(input);
    expect(first).toMatchObject({ ok: true, value: { requiredQuantityBase: 9 } });
    const replay = await core.aggregateAdminProcurementDemand({
      ...input,
      requestId: crypto.randomUUID(),
    });
    expect(replay).toMatchObject({
      ok: true,
      value: { requirementId: first.ok ? first.value.requirementId : "" },
    });
    expect(
      await core.aggregateAdminProcurementDemand({
        ...input,
        cycleId: "cycle-conflict",
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='OPERATIONS.PROCUREMENT_DEMAND_AGGREGATED' AND idempotency_key=?",
    )
      .bind(key)
      .first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });
});
