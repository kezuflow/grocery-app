import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { adjustInventory } from "./adjust-inventory";
import { requestHash } from "../../idempotency";
const core = exports.default;
const locationId = "location-cebu-central",
  inventoryPoolId = "pool-red-onion";
async function fixture() {
  const manager = await locationManager("location");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='inventory.adjust'",
  )
    .bind(manager.id)
    .run();
  const actor = await env.DB.prepare("SELECT auth_user_id id FROM staff_identity WHERE id=?")
    .bind(manager.id)
    .first<{ id: string }>();
  const before = await env.DB.prepare(
    "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(locationId, inventoryPoolId)
    .first<{ on_hand: number; reserved: number; version: number }>();
  if (!actor || !before) throw new Error("Missing inventory fixture");
  const request = {
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    locationId,
    inventoryPoolId,
    delta: 5,
    reason: "Inspected stock count",
    expectedVersion: before.version,
    idempotencyKey: crypto.randomUUID(),
  };
  return {
    manager,
    before,
    request,
    command: { ...request, deltaBase: request.delta, actorId: actor.id, actorAuthUserId: actor.id },
  };
}
async function noEffects(
  key: string,
  before: { on_hand: number; reserved: number; version: number },
) {
  expect(
    await env.DB.prepare(
      "SELECT on_hand,reserved,version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
    )
      .bind(locationId, inventoryPoolId)
      .first(),
  ).toEqual(before);
  expect(
    await env.DB.prepare("SELECT id FROM inventory_ledger_entries WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?").bind(key).first(),
  ).toBeNull();
}
describe("inventory command authority and recovery", () => {
  it("returns the original balance after later adjustments and audits exactly once", async () => {
    const { request, before } = await fixture();
    const first = await core.adjustInventory(request);
    expect(first).toMatchObject({
      ok: true,
      value: { onHandBase: before.on_hand + 5, version: before.version + 1 },
    });
    expect(
      await core.adjustInventory({
        ...request,
        delta: 3,
        expectedVersion: before.version + 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { onHandBase: before.on_hand + 8 } });
    expect(await core.adjustInventory(request)).toEqual(first);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(await core.adjustInventory({ ...request, reason: "Changed" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });
  it.each(["scope", "permission", "staff", "late-failure"] as const)(
    "rejects %s loss before commit without stock, ledger, audit or idempotency effects",
    async (kind) => {
      const { manager, command, request, before } = await fixture();
      let reached = false;
      // Application-boundary injection follows a real authenticated fixture;
      // the public RPC's independent authorization/replay is exercised above.
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "permission")
                await target
                  .prepare("DELETE FROM role_permission WHERE role_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "staff")
                await target
                  .prepare("UPDATE staff_identity SET status='inactive' WHERE id=?")
                  .bind(manager.id)
                  .run();
              return target.batch(
                kind === "late-failure"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)")]
                  : statements,
              );
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await adjustInventory(database, command)).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      await noEffects(request.idempotencyKey, before);
      if (kind === "late-failure")
        expect(await core.adjustInventory(request)).toMatchObject({ ok: true });
    },
  );
  it("recovers a retained unapplied claim and refuses to fabricate a historical successful snapshot", async () => {
    const { request, before } = await fixture();
    const hash = await requestHash({
      locationId,
      inventoryPoolId,
      deltaBase: request.delta,
      reason: request.reason,
      expectedVersion: request.expectedVersion,
    });
    await env.DB.prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES ('inventory.adjust',?,?,'PROCESSING','inventory_balance',1,1)",
    )
      .bind(request.idempotencyKey, hash)
      .run();
    expect(await core.adjustInventory(request)).toMatchObject({
      ok: true,
      value: { onHandBase: before.on_hand + 5 },
    });
    await env.DB.prepare(
      "UPDATE idempotency_records SET request_hash=?,result_reference=? WHERE scope='inventory.adjust' AND idempotency_key=?",
    )
      .bind(hash, `${locationId}:${inventoryPoolId}`, request.idempotencyKey)
      .run();
    expect(await core.adjustInventory(request)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: expect.stringContaining("already applied") },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_ledger_entries WHERE idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});
