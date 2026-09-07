import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { recordAdminReceivedLine } from "../../admin/application/operations-commands";
const core = exports.default;
const locationId = "location-cebu-central";
async function fixture() {
  const manager = await locationManager("location"),
    id = crypto.randomUUID(),
    cycleId = `cycle-${id}`;
  await seedTestCycle(env.DB, cycleId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('procurement.manage','fulfillment.manage')",
    ).bind(manager.id),
    env.DB.prepare(
      "INSERT INTO procurement_requirement(id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version) VALUES (?,?,?,'pool-red-onion',10,'ORDERED',1)",
    ).bind(id, cycleId, locationId),
    env.DB.prepare(
      "INSERT INTO receiving_record(id,procurement_requirement_id,expected_quantity,accepted_quantity,rejected_quantity,status,version) VALUES (?,?,10,0,0,'NOT_STARTED',1)",
    ).bind(id, id),
  ]);
  const common = { headers: manager.headers, locationId, requestId: crypto.randomUUID() };
  expect(
    await core.startAdminReceiving({
      ...common,
      requirementId: id,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true, value: { status: "IN_PROGRESS", version: 2 } });
  return {
    manager,
    cycleId,
    id,
    request: {
      ...common,
      receivingSessionId: id,
      expectedVersion: 2,
      acceptedBase: 7,
      rejectedBase: 3,
      idempotencyKey: crypto.randomUUID(),
      reason: "Inspected goods",
    },
  };
}
async function noEffects(id: string, cycleId: string, key: string) {
  expect(
    await env.DB.prepare(
      "SELECT accepted_quantity,rejected_quantity,status,version FROM receiving_record WHERE id=?",
    )
      .bind(id)
      .first(),
  ).toEqual({ accepted_quantity: 0, rejected_quantity: 0, status: "IN_PROGRESS", version: 2 });
  expect(
    await env.DB.prepare("SELECT id FROM receiving_event WHERE receiving_record_id=?")
      .bind(id)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT cycle_id FROM cycle_goods_balance WHERE cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?").bind(key).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
}
describe("reachable receiving authority and recovery", () => {
  it("replays the frozen receipt result after discrepancy completion", async () => {
    const { request, cycleId } = await fixture();
    const before = await env.DB.prepare(
      "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
    ).all();
    const first = await core.recordAdminReceivedLine(request);
    expect(first).toMatchObject({
      ok: true,
      value: {
        acceptedBase: 7,
        rejectedBase: 3,
        status: "DISCREPANCY",
        version: 3,
        legacyAcceptedBase: 0,
      },
    });
    expect(
      await core.completeAdminReceiving({
        ...request,
        expectedVersion: 3,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { status: "COMPLETED", version: 4 } });
    expect(await core.recordAdminReceivedLine(request)).toEqual(first);
    expect(
      await env.DB.prepare("SELECT received_base FROM cycle_goods_balance WHERE cycle_id=?")
        .bind(cycleId)
        .first(),
    ).toEqual({ received_base: 7 });
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
        ).all()
      ).results,
    ).toEqual(before.results);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cycle_goods_movement WHERE cycle_id=?")
        .bind(cycleId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await core.recordAdminReceivedLine({ ...request, reason: "Different inspection" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it.each(["scope", "permission", "staff"] as const)(
    "rejects a %s revocation at the batch boundary without any dependent effect",
    async (kind) => {
      const { manager, request, id, cycleId } = await fixture();
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              const sql =
                kind === "scope"
                  ? "DELETE FROM staff_scope WHERE staff_id=?"
                  : kind === "permission"
                    ? "DELETE FROM role_permission WHERE role_id=?"
                    : "UPDATE staff_identity SET status='inactive' WHERE id=?";
              await target.prepare(sql).bind(manager.id).run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await recordAdminReceivedLine({ db: database, auth: createAuth(env) }, request),
      ).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      await noEffects(id, cycleId, request.idempotencyKey);
    },
  );
  it("rolls back a late failure and recovers through the identical live command", async () => {
    const { request, id, cycleId } = await fixture();
    let reached = false;
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            reached = true;
            return target.batch([
              ...statements,
              target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)"),
            ]);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await recordAdminReceivedLine({ db: database, auth: createAuth(env) }, request),
    ).toMatchObject({ ok: false });
    expect(reached).toBe(true);
    await noEffects(id, cycleId, request.idempotencyKey);
    const results = await Promise.all([
      core.recordAdminReceivedLine(request),
      core.recordAdminReceivedLine(request),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("rejects unauthenticated and wrong-location RPC requests", async () => {
    const { request, id, cycleId } = await fixture();
    expect(await core.recordAdminReceivedLine({ ...request, headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(
      await core.recordAdminReceivedLine({ ...request, locationId: "location-cebu-satellite" }),
    ).toMatchObject({ ok: false });
    await noEffects(id, cycleId, request.idempotencyKey);
  });
});
