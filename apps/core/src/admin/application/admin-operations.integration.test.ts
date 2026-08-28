import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;
let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const email = `operations-${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Operations staff", email, password }),
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
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedStaff(capability: string, scope: "global" | "location") {
  const principal = await signUp();
  const now = Date.now();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Ops', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Ops role', ?)",
    ).bind(roleId, `ops-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      scope,
      scope === "location" ? "location-cebu-central" : null,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'operations', ?)",
    ).bind(crypto.randomUUID(), capability, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
    ).bind(roleId, capability),
  ]);
  return principal.cookie;
}

async function seedProcurementRequirement(cycleId: string, suffix: string): Promise<string> {
  const id = `requirement-page-${suffix}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', 100, 'ORDERED', 1)",
  )
    .bind(id, cycleId)
    .run();
  return id;
}

async function seedReceivingRecord(requirementId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 100, 0, 0, 'IN_PROGRESS', 1)",
  )
    .bind(`receiving-${crypto.randomUUID()}`, requirementId)
    .run();
}

describe("admin operations reads", () => {
  it("requires the named capability and operational scope instead of global scope", async () => {
    expect(
      await core.listProcurementRequirements({
        requestId: "r1",
        headers: {},
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const scopedReader = await seedStaff("procurement.read", "location");
    expect(
      await core.listProcurementRequirements({
        requestId: crypto.randomUUID(),
        headers: { cookie: scopedReader },
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await core.listProcurementRequirements({
        requestId: crypto.randomUUID(),
        headers: { cookie: scopedReader },
        locationId: "location-not-allowed",
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("returns NOT_FOUND for an unknown location even to a globally scoped reader", async () => {
    const globalReader = await seedStaff("fulfillment.read", "global");
    expect(
      await core.getFulfillmentMode({
        requestId: crypto.randomUUID(),
        headers: { cookie: globalReader },
        locationId: `location-missing-${crypto.randomUUID()}`,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("scopes the converged exception queue and honors its cursor contract", async () => {
    expect(
      await core.listOperationalExceptions({
        requestId: crypto.randomUUID(),
        headers: {},
        locationId: "location-cebu-central",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    const reader = await seedStaff("fulfillment.manage", "location");
    const requirementId = await seedProcurementRequirement("cycle-next-cebu", "exceptions");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at, version) VALUES (?, ?, 'SHORTAGE', 10, 'OPEN', ?, 1)",
      ).bind(`exception-${crypto.randomUUID()}`, requirementId, Date.now() - 60_000),
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at, version) VALUES (?, ?, 'QUALITY', 5, 'OPEN', ?, 1)",
      ).bind(`exception-${crypto.randomUUID()}`, requirementId, Date.now() - 30_000),
    ]);
    const first = await core.listOperationalExceptions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      limit: 1,
    });
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(1);
    expect(first.value.items[0]).not.toHaveProperty("queueKey");
    expect(first.value.nextCursor).toBeTruthy();
    const second = await core.listOperationalExceptions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      limit: 1,
      cursor: first.value.nextCursor!,
    });
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(1);
    expect(second.value.items[0]!.referenceId).not.toBe(first.value.items[0]!.referenceId);
    expect(second.value.nextCursor).toBeNull();
  });

  it("applies cycle filtering before keyset pagination and returns a real next cursor", async () => {
    const reader = await seedStaff("procurement.read", "location");
    const cycleId = `cycle-page-${crypto.randomUUID().slice(0, 8)}`;
    await seedProcurementRequirement(cycleId, "a");
    await seedProcurementRequirement(cycleId, "b");

    const first = await core.listProcurementRequirements({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      cycleId,
      limit: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(1);
    expect(first.value.nextCursor).toBeTruthy();

    const second = await core.listProcurementRequirements({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      cycleId,
      limit: 1,
      cursor: first.value.nextCursor!,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(1);
    expect(second.value.items[0]!.requirementId).not.toBe(first.value.items[0]!.requirementId);
    expect(second.value.nextCursor).toBeNull();
  });

  it("uses the procurement requirement identity for receiving keyset cursors", async () => {
    const reader = await seedStaff("receiving.manage", "location");
    const cycleId = `cycle-receiving-${crypto.randomUUID().slice(0, 8)}`;
    const firstRequirement = await seedProcurementRequirement(cycleId, "receiving-a");
    const secondRequirement = await seedProcurementRequirement(cycleId, "receiving-b");
    await seedReceivingRecord(firstRequirement);
    await seedReceivingRecord(secondRequirement);
    const first = await core.listReceivingSessions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      cycleId,
      limit: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await core.listReceivingSessions({
      requestId: crypto.randomUUID(),
      headers: { cookie: reader },
      locationId: "location-cebu-central",
      cycleId,
      limit: 1,
      cursor: first.value.nextCursor!,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items[0]!.requirementId).not.toBe(first.value.items[0]!.requirementId);
  });

  it("returns the persisted Scheduled cadence from mode activation", async () => {
    const manager = await seedStaff("fulfillment.manage", "location");
    const result = await core.activateFulfillmentMode({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager },
      locationId: "location-cebu-central",
      fulfillmentMode: "SCHEDULED",
      cadence: "WEEKLY",
      promiseMinutes: null,
      maxConcurrentInstantOrders: null,
      expectedVersion: null,
      idempotencyKey: `mode-${crypto.randomUUID()}`,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { activeMode: "SCHEDULED", cadence: "WEEKLY" },
    });
  });
});
