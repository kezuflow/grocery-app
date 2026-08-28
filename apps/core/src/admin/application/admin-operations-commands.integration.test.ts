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
  return cookie;
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
        quantityBase: 1,
        expectedVersion: 0,
        idempotencyKey: "aggregate-none",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const cookie = await manager(["fulfillment.manage"]);
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
    const cookie = await manager(["receiving.manage"]),
      id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, 'cycle-ops', 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1)",
      ).bind(id),
      env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 10, 0, 0, 'IN_PROGRESS', 1)",
      ).bind(`receipt-${id}`, id),
    ]);
    const recorded = await core.recordAdminReceivedLine({
      requestId: crypto.randomUUID(),
      headers: { cookie },
      locationId: "location-cebu-central",
      receivingSessionId: `receipt-${id}`,
      acceptedBase: 7,
      rejectedBase: 3,
      expectedVersion: 1,
      idempotencyKey: `line-${crypto.randomUUID()}`,
      reason: "quality rejection",
    });
    expect(recorded).toMatchObject({ ok: true, value: { acceptedBase: 7, rejectedBase: 3 } });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='OPERATIONS.RECEIVING_LINE_RECORDED'",
    ).first<{ count: number }>();
    expect(audit?.count).toBeGreaterThan(0);
  });
});
