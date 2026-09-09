import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { recordAdminReceivedLine } from "../../admin/application/operations-commands";
const core = exports.default;
const locationId = "location-cebu-central";

it("preserves missing/rejected evidence while replacements fill only the outstanding paid quantity", async () => {
  const { request, id, cycleId } = await fixture();
  const before = await env.DB.prepare(
    "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
  ).all();
  const initial = await core.recordAdminReceivedLine({
    ...request,
    acceptedBase: 7,
    rejectedBase: 1,
    shortageBase: 2,
  });
  expect(initial).toMatchObject({
    ok: true,
    value: {
      acceptedBase: 7,
      rejectedBase: 1,
      shortageBase: 2,
      replacementBase: 0,
      status: "DISCREPANCY",
      version: 3,
    },
  });
  const replacement = {
    ...request,
    receiptKind: "REPLACEMENT" as const,
    acceptedBase: 1,
    rejectedBase: 0,
    expectedVersion: 3,
    idempotencyKey: crypto.randomUUID(),
  };
  const partial = await core.recordAdminReceivedLine(replacement);
  expect(partial).toMatchObject({
    ok: true,
    value: { acceptedBase: 8, rejectedBase: 1, shortageBase: 2, replacementBase: 1, version: 4 },
  });
  expect(await core.recordAdminReceivedLine(replacement)).toEqual(partial);
  expect(await core.recordAdminReceivedLine({ ...replacement, acceptedBase: 2 })).toMatchObject({
    ok: false,
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
  expect(
    await core.recordAdminReceivedLine({
      ...replacement,
      expectedVersion: 4,
      acceptedBase: 3,
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  const final = await core.recordAdminReceivedLine({
    ...replacement,
    expectedVersion: 4,
    acceptedBase: 2,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(final).toMatchObject({
    ok: true,
    value: {
      acceptedBase: 10,
      rejectedBase: 1,
      shortageBase: 2,
      replacementBase: 3,
      status: "COMPLETED",
    },
  });
  expect(
    await env.DB.prepare(
      "SELECT kind,affected_quantity,status,resolution FROM supply_exception WHERE requirement_id=? ORDER BY kind",
    )
      .bind(id)
      .all(),
  ).toMatchObject({
    results: [
      {
        kind: "QUALITY",
        affected_quantity: 1,
        status: "RESOLVED",
        resolution: "REPLACEMENT_RECEIVED",
      },
      {
        kind: "SHORTAGE",
        affected_quantity: 2,
        status: "RESOLVED",
        resolution: "REPLACEMENT_RECEIVED",
      },
    ],
  });
  expect(
    await env.DB.prepare("SELECT received_base FROM cycle_goods_balance WHERE cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toEqual({ received_base: 10 });
  await expect(
    env.DB.prepare("UPDATE receiving_event SET accepted_delta=1 WHERE receiving_record_id=?")
      .bind(id)
      .run(),
  ).rejects.toThrow("IMMUTABLE_RECEIVING_EVIDENCE");
  await expect(
    env.DB.prepare("DELETE FROM receiving_event WHERE receiving_record_id=?").bind(id).run(),
  ).rejects.toThrow("IMMUTABLE_RECEIVING_EVIDENCE");
  await expect(
    env.DB.prepare("UPDATE supply_exception SET affected_quantity=9 WHERE requirement_id=?")
      .bind(id)
      .run(),
  ).rejects.toThrow("IMMUTABLE_SUPPLY_OBSERVATION");
  expect(
    await env.DB.prepare(
      "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
    ).all(),
  ).toMatchObject({ results: before.results });
});

it.each([
  "supply_exception",
  "receiving_event",
  "cycle_goods_balance",
  "cycle_goods_movement",
  "audit_event",
])("rolls back a silently omitted %s during discrepancy receiving", async (table) => {
  const { request, id, cycleId } = await fixture();
  const trigger = `ignore_receiving_${table}`;
  await env.DB.exec(
    `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
  );
  try {
    expect(
      await core.recordAdminReceivedLine({
        ...request,
        acceptedBase: 7,
        rejectedBase: 1,
        shortageBase: 2,
      }),
    ).toMatchObject({ ok: false });
    await noEffects(id, cycleId, request.idempotencyKey);
    expect(
      await env.DB.prepare("SELECT id FROM supply_exception WHERE requirement_id=?")
        .bind(id)
        .first(),
    ).toBeNull();
  } finally {
    await env.DB.exec(`DROP TRIGGER ${trigger}`);
  }
});

it("serializes replacement receipts and recovers a lost committed database reply", async () => {
  const { request, cycleId } = await fixture();
  expect(await core.recordAdminReceivedLine(request)).toMatchObject({ ok: true });
  const replacement = {
    ...request,
    receiptKind: "REPLACEMENT" as const,
    acceptedBase: 3,
    rejectedBase: 0,
    expectedVersion: 3,
    idempotencyKey: crypto.randomUUID(),
  };
  const database = new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await target.batch(statements);
          throw new Error("Synthetic lost reply");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const outcomes = await Promise.all([
    recordAdminReceivedLine({ db: database, auth: createAuth(env) }, replacement),
    core.recordAdminReceivedLine({ ...replacement, idempotencyKey: crypto.randomUUID() }),
  ]);
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
  expect(
    await env.DB.prepare("SELECT received_base FROM cycle_goods_balance WHERE cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toEqual({ received_base: 10 });
});
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
