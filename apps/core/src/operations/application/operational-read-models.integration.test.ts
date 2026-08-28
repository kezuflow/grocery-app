import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function staffCookie(options: {
  permissionCodes: string[];
  locationId?: string | null;
}): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `reads-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUp = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Ops Reader", email, password }),
  });
  expect(signUp.status).toBeLessThan(400);
  const body = (await signUp.json()) as { user?: { id?: string } };
  const userId = body.user!.id!;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(userId).run();
  let cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  }
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Ops Reader', 'active', ?, ?)",
    ).bind(staffId, userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Reader Role', ?)",
    ).bind(roleId, `read-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
    ).bind(crypto.randomUUID(), staffId, options.locationId ?? "location-cebu-central"),
  ];
  for (const code of options.permissionCodes) {
    const permissionId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'op', ?)",
      ).bind(permissionId, code, now),
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, code),
    );
  }
  await env.DB.batch(statements);
  return { cookie, userId };
}

let queueCounter = 0;
async function seedOperationalRow(options: {
  locationId?: string;
  fulfillmentStatus?: string;
  deliveryStatus?: string;
  riderAuthUserId?: string | null;
}) {
  const unique = ++queueCounter;
  const orderId = `ord-board-${unique}-${crypto.randomUUID().slice(0, 6)}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)",
    ).bind(
      crypto.randomUUID(),
      orderId,
      options.locationId ?? "location-cebu-central",
      options.fulfillmentStatus ?? "PENDING",
      now,
    ),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, rider_user_id, status, address_snapshot_json, delivered_at, version) VALUES (?, ?, 'cycle-next-cebu', ?, ?, '{}', NULL, 1)",
    ).bind(
      crypto.randomUUID(),
      orderId,
      options.riderAuthUserId ?? null,
      options.deliveryStatus ?? "PENDING",
    ),
  ]);
  return orderId;
}

describe("scoped operational read models", () => {
  it("denies an unauthenticated board request", async () => {
    const result = await core.adminOperationsBoard({
      requestId: crypto.randomUUID(),
      headers: {},
    });
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("returns only authorized sections with legal allowedActions for the requested location", async () => {
    await seedOperationalRow({ fulfillmentStatus: "PENDING", deliveryStatus: "PENDING" });
    await seedOperationalRow({ fulfillmentStatus: "SHORTAGE", deliveryStatus: "FAILED" });
    const fullAccess = await staffCookie({
      permissionCodes: ["fulfillment.manage", "delivery.manage", "procurement.manage"],
    });
    const board = await core.adminOperationsBoard({
      requestId: crypto.randomUUID(),
      headers: { cookie: fullAccess.cookie },
    });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const value = board.value;
    expect(value.locationId).toBe("location-cebu-central");
    expect(value.sectionsDenied).toEqual([]);
    const pending = value.fulfillment.find((f) => f.status === "PENDING");
    expect(pending?.allowedActions).toEqual(["START"]);
    const shortage = value.fulfillment.find((f) => f.status === "SHORTAGE");
    expect(shortage?.allowedActions).toEqual(["START"]);
    const failedDelivery = value.delivery.find((d) => d.status === "FAILED");
    expect(failedDelivery?.allowedActions).toContain("DISPATCH");
    expect(failedDelivery).not.toHaveProperty("addressSnapshotJson");
    expect(value.exceptions.map((e) => e.kind)).toContain("FULFILLMENT_SHORTAGE");

    // Cross-location staff sees nothing from the other location.
    const otherLocationRow = await seedOperationalRow({
      locationId: "location-other-empty",
      fulfillmentStatus: "PENDING",
    });
    const scoped = await core.adminOperationsBoard({
      requestId: crypto.randomUUID(),
      headers: { cookie: fullAccess.cookie },
    });
    if (scoped.ok) {
      const ids = scoped.value.fulfillment.map((f) => f.orderId);
      expect(ids).not.toContain(otherLocationRow);
    }
  });

  it("reports sections denied when capabilities are missing instead of leaking rows", async () => {
    const fulfillmentOnly = await staffCookie({ permissionCodes: ["fulfillment.manage"] });
    const board = await core.adminOperationsBoard({
      requestId: crypto.randomUUID(),
      headers: { cookie: fulfillmentOnly.cookie },
    });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.value.sectionsDenied).toEqual(["delivery", "procurement"]);
    expect(board.value.delivery).toEqual([]);
  });

  it("lets a supervisor assign a rider and riders see only their own jobs", async () => {
    const supervisor = await staffCookie({
      permissionCodes: ["delivery.manage", "orders.manage"],
    });
    const riderA = await staffCookie({ permissionCodes: ["delivery.manage"] });
    const riderB = await staffCookie({
      permissionCodes: ["delivery.manage"],
      locationId: "location-other-empty",
    });
    const jobA = await seedOperationalRow({ deliveryStatus: "PENDING" });
    const jobB = await seedOperationalRow({ deliveryStatus: "PENDING" });

    const assigned = await core.assignRider({
      requestId: crypto.randomUUID(),
      headers: { cookie: supervisor.cookie },
      orderId: jobA,
      riderAuthUserId: riderA.userId,
      expectedVersion: 1,
      idempotencyKey: `assign-${crypto.randomUUID()}`,
    });
    expect(assigned.ok).toBe(true);
    const assignedB = await core.assignRider({
      requestId: crypto.randomUUID(),
      headers: { cookie: supervisor.cookie },
      orderId: jobB,
      riderAuthUserId: riderB.userId,
      expectedVersion: 1,
      idempotencyKey: `assign-${crypto.randomUUID()}`,
    });
    expect(assignedB.ok).toBe(true);

    // A rider without staff identity cannot be assigned.
    const nonStaff = await staffCookie({ permissionCodes: [] }).then((u) =>
      env.DB.prepare("DELETE FROM staff_identity WHERE auth_user_id=?")
        .bind(u.userId)
        .run()
        .then(() => u.userId),
    );
    const rejected = await core.assignRider({
      requestId: crypto.randomUUID(),
      headers: { cookie: supervisor.cookie },
      orderId: jobB,
      riderAuthUserId: nonStaff,
      expectedVersion: 1,
      idempotencyKey: `assign-${crypto.randomUUID()}`,
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const stale = await core.assignRider({
      requestId: crypto.randomUUID(),
      headers: { cookie: supervisor.cookie },
      orderId: jobA,
      riderAuthUserId: riderB.userId,
      expectedVersion: 99,
      idempotencyKey: `assign-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    for (const [rider, expected] of [
      [riderA, [jobA]],
      [riderB, [jobB]],
    ] as const) {
      const jobs = await core.riderJobs({
        requestId: crypto.randomUUID(),
        headers: { cookie: rider.cookie },
      });
      expect(jobs.ok).toBe(true);
      if (!jobs.ok) continue;
      const ids = jobs.value.jobs.map((j) => j.orderId);
      expect(ids).toEqual(expect.arrayContaining([...expected]));
      expect(ids).not.toContain(rider === riderA ? jobB : jobA);
    }
  });

  it("denies a rider acting on another rider's assigned job while supervisors keep access", async () => {
    const supervisor = await staffCookie({ permissionCodes: ["delivery.manage", "orders.manage"] });
    const riderA = await staffCookie({ permissionCodes: ["delivery.manage"] });
    const riderB = await staffCookie({ permissionCodes: ["delivery.manage"] });
    const jobId = await seedOperationalRow({ deliveryStatus: "PENDING" });
    await core.assignRider({
      requestId: crypto.randomUUID(),
      headers: { cookie: supervisor.cookie },
      orderId: jobId,
      riderAuthUserId: riderB.userId,
      expectedVersion: 1,
      idempotencyKey: `assign-${crypto.randomUUID()}`,
    });
    const deniedForOtherRider = await core.advanceDelivery({
      requestId: crypto.randomUUID(),
      headers: { cookie: riderA.cookie },
      orderId: jobId,
      action: "DISPATCH",
      expectedVersion: 1,
      idempotencyKey: `adv-${crypto.randomUUID()}`,
    });
    expect(deniedForOtherRider).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    // Assignment bumped the job to version 2; the assigned rider dispatches
    // against the current version.
    const allowedForAssignee = await core.advanceDelivery({
      requestId: crypto.randomUUID(),
      headers: { cookie: riderB.cookie },
      orderId: jobId,
      action: "DISPATCH",
      expectedVersion: 2,
      idempotencyKey: `adv-${crypto.randomUUID()}`,
    });
    expect(allowedForAssignee.ok).toBe(true);
  });
});
