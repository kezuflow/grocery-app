import { seedTestCycle } from "../../test-commerce-fixtures";
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { startReceiving, type StartReceivingCommand } from "./start-receiving";
import { recordReceivedLine, type RecordReceivedLineCommand } from "./record-received-line";
import { completeReceiving } from "./complete-receiving";
import { requestHash } from "../../idempotency";

const locationId = "location-cebu-central";
const inventoryPoolId = "pool-red-onion";

type Fixture = { requirementId: string; receivingRecordId: string };

async function fixture(
  options: {
    expected?: number;
    requirementStatus?: string;
    recordStatus?: string;
    recordVersion?: number;
    accepted?: number;
    rejected?: number;
  } = {},
): Promise<Fixture> {
  const requirementId = `req-${crypto.randomUUID()}`;
  const receivingRecordId = `rec-${crypto.randomUUID()}`;
  await seedTestCycle(env.DB, `cycle-${requirementId}`);
  const {
    expected = 10,
    requirementStatus = "ORDERED",
    recordStatus = "IN_PROGRESS",
    recordVersion = 1,
    accepted = 0,
    rejected = 0,
  } = options;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, ?, ?, ?, ?, ?, 1)",
    ).bind(
      requirementId,
      `cycle-${requirementId}`,
      locationId,
      inventoryPoolId,
      expected,
      requirementStatus,
    ),
    env.DB.prepare(
      "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      receivingRecordId,
      requirementId,
      expected,
      accepted,
      rejected,
      recordStatus,
      recordVersion,
    ),
  ]);
  return { requirementId, receivingRecordId };
}

async function record(receivingRecordId: string) {
  return env.DB.prepare(
    "SELECT expected_quantity, accepted_quantity, rejected_quantity, status, version FROM receiving_record WHERE id=?",
  )
    .bind(receivingRecordId)
    .first<{
      expected_quantity: number;
      accepted_quantity: number;
      rejected_quantity: number;
      status: string;
      version: number;
    }>();
}

async function balance() {
  return env.DB.prepare(
    "SELECT on_hand, version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(locationId, inventoryPoolId)
    .first<{ on_hand: number; version: number }>();
}

async function allocation(fx: Fixture) {
  return env.DB.prepare(
    "SELECT received_base,packed_base,surplus_released_base,disposed_base,version FROM cycle_goods_balance WHERE cycle_id=? AND location_id=? AND inventory_pool_id=?",
  )
    .bind(`cycle-${fx.requirementId}`, locationId, inventoryPoolId)
    .first();
}

async function cleanInventory() {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
    ).bind(locationId, inventoryPoolId),
    env.DB.prepare(
      "DELETE FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='RECEIVING_ACCEPTED'",
    ).bind(locationId, inventoryPoolId),
  ]);
}

async function counts(receivingRecordId: string) {
  const [events, ledger, allocations] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM receiving_event WHERE receiving_record_id=?")
      .bind(receivingRecordId)
      .first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='RECEIVING_ACCEPTED'",
    )
      .bind(locationId, inventoryPoolId)
      .first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) count FROM cycle_goods_movement WHERE receiving_event_id IN (SELECT id FROM receiving_event WHERE receiving_record_id=?)",
    )
      .bind(receivingRecordId)
      .first<{ count: number }>(),
  ]);
  return {
    events: events?.count ?? 0,
    ledger: ledger?.count ?? 0,
    allocations: allocations?.count ?? 0,
  };
}

function startCommand(
  fx: Fixture,
  overrides: Partial<StartReceivingCommand> = {},
): StartReceivingCommand {
  return {
    requirementId: fx.requirementId,
    expectedVersion: 1,
    idempotencyKey: `start-${crypto.randomUUID()}`,
    actorId: `actor-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

function lineCommand(
  fx: Fixture,
  overrides: Partial<RecordReceivedLineCommand> = {},
): RecordReceivedLineCommand {
  return {
    receivingRecordId: fx.receivingRecordId,
    acceptedDeltaBase: 4,
    rejectedDeltaBase: 0,
    reason: "test-receiving",
    expectedVersion: 1,
    idempotencyKey: `line-${crypto.randomUUID()}`,
    actorId: `actor-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("start receiving", () => {
  it("allows only one concurrent start and never records success for the loser", async () => {
    const fx = await fixture({ recordStatus: "NOT_STARTED" });
    const commands = [startCommand(fx), startCommand(fx)];
    const results = await Promise.all(commands.map((command) => startReceiving(env.DB, command)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await record(fx.receivingRecordId)).toMatchObject({ status: "IN_PROGRESS", version: 2 });
    const evidence = await env.DB.prepare(
      "SELECT COUNT(*) count FROM idempotency_records WHERE scope='procurement.startReceiving' AND idempotency_key IN (?,?) AND status='SUCCEEDED'",
    )
      .bind(commands[0]?.idempotencyKey, commands[1]?.idempotencyKey)
      .first();
    expect(evidence).toEqual({ count: 1 });
  });
  it("transitions a pending record to in progress idempotently", async () => {
    const fx = await fixture({ recordStatus: "NOT_STARTED" });
    const attempt = startCommand(fx);
    const first = await startReceiving(env.DB, attempt);
    expect(first).toMatchObject({ ok: true, value: { status: "IN_PROGRESS", version: 2 } });
    const replay = await startReceiving(env.DB, attempt);
    expect(replay).toEqual(first);
  });

  it("rejects starting when the requirement is not orderable", async () => {
    const fx = await fixture({ requirementStatus: "AGGREGATED", recordStatus: "NOT_STARTED" });
    const before = await record(fx.receivingRecordId);
    const command = startCommand(fx);
    const result = await startReceiving(env.DB, command);
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(await record(fx.receivingRecordId)).toEqual(before);
    expect(
      await env.DB.prepare(
        "SELECT status FROM idempotency_records WHERE scope='procurement.startReceiving' AND idempotency_key=? AND status='SUCCEEDED'",
      )
        .bind(command.idempotencyKey)
        .first(),
    ).toBeNull();
  });
});

describe("record received line", () => {
  it("recovers an unapplied retained claim and never reposts a retained successful command", async () => {
    const fx = await fixture();
    const command = lineCommand(fx);
    const hash = await requestHash({
      receivingRecordId: command.receivingRecordId,
      acceptedDeltaBase: command.acceptedDeltaBase,
      rejectedDeltaBase: command.rejectedDeltaBase,
      reason: command.reason,
      expectedVersion: command.expectedVersion,
    });
    await env.DB.prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES ('procurement.recordReceivedLine',?,?,'PROCESSING','receiving_record',1,1)",
    )
      .bind(command.idempotencyKey, hash)
      .run();
    expect(await recordReceivedLine(env.DB, command)).toMatchObject({
      ok: true,
      value: { acceptedBase: 4 },
    });
    await env.DB.prepare(
      "UPDATE idempotency_records SET request_hash=?,result_reference=? WHERE scope='procurement.recordReceivedLine' AND idempotency_key=?",
    )
      .bind(hash, fx.receivingRecordId, command.idempotencyKey)
      .run();
    expect(await recordReceivedLine(env.DB, command)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: expect.stringContaining("already applied") },
    });
    expect(await record(fx.receivingRecordId)).toMatchObject({ accepted_quantity: 4, version: 2 });
    expect(await allocation(fx)).toMatchObject({ received_base: 4 });
    expect(await counts(fx.receivingRecordId)).toEqual({ events: 1, ledger: 0, allocations: 1 });
  });
  it("does not resolve a receipt after its procurement requirement is closed", async () => {
    const fx = await fixture({
      recordStatus: "DISCREPANCY",
      requirementStatus: "CLOSED",
      accepted: 7,
      rejected: 3,
    });
    const command = {
      receivingRecordId: fx.receivingRecordId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    expect(await completeReceiving(env.DB, command)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    expect(await record(fx.receivingRecordId)).toMatchObject({ status: "DISCREPANCY", version: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(command.idempotencyKey)
        .first(),
    ).toBeNull();
  });
  it("losing the requirement version leaves receipt, stock, events and success unchanged", async () => {
    await cleanInventory();
    const fx = await fixture();
    const before = await record(fx.receivingRecordId);
    const command = lineCommand(fx);
    let reached = false;
    const database = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            reached = true;
            await env.DB.prepare("UPDATE procurement_requirement SET version=version+1 WHERE id=?")
              .bind(fx.requirementId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await recordReceivedLine(database, command)).toMatchObject({
      ok: false,
      error: { code: "STALE_VERSION" },
    });
    expect(reached).toBe(true);
    expect(await record(fx.receivingRecordId)).toEqual(before);
    expect(await balance()).toBeNull();
    expect(await allocation(fx)).toBeNull();
    expect(await counts(fx.receivingRecordId)).toEqual({ events: 0, ledger: 0, allocations: 0 });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(command.idempotencyKey)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?")
        .bind(command.idempotencyKey)
        .first(),
    ).toBeNull();
  });

  it("records completion success only for the winning concurrent command", async () => {
    const fx = await fixture({
      recordStatus: "DISCREPANCY",
      requirementStatus: "RECEIVED",
      accepted: 7,
      rejected: 3,
    });
    const first = {
      receivingRecordId: fx.receivingRecordId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    const second = { ...first, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      completeReceiving(env.DB, first),
      completeReceiving(env.DB, second),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await record(fx.receivingRecordId)).toMatchObject({ status: "COMPLETED", version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE scope='procurement.completeReceiving' AND idempotency_key IN (?,?) AND status='SUCCEEDED'",
      )
        .bind(first.idempotencyKey, second.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("rejects zero and negative deltas without mutation", async () => {
    const fx = await fixture();
    const zero = await recordReceivedLine(
      env.DB,
      lineCommand(fx, { acceptedDeltaBase: 0, rejectedDeltaBase: 0 }),
    );
    expect(zero).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const negative = await recordReceivedLine(env.DB, lineCommand(fx, { acceptedDeltaBase: -1 }));
    expect(negative).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await record(fx.receivingRecordId)).toMatchObject({ accepted_quantity: 0, version: 1 });
  });

  it("rejects cumulative totals beyond the expected quantity", async () => {
    const fx = await fixture();
    const result = await recordReceivedLine(env.DB, lineCommand(fx, { acceptedDeltaBase: 11 }));
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await record(fx.receivingRecordId)).toMatchObject({ accepted_quantity: 0, version: 1 });
  });

  it("rejects illegal procurement states and stale versions", async () => {
    const illegal = await fixture({ requirementStatus: "AGGREGATED" });
    const illegalResult = await recordReceivedLine(env.DB, lineCommand(illegal));
    expect(illegalResult).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });

    const stale = await fixture();
    const staleResult = await recordReceivedLine(
      env.DB,
      lineCommand(stale, { expectedVersion: 2 }),
    );
    expect(staleResult).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("commits exact cycle allocation and immutable receipt evidence without physical stock", async () => {
    await cleanInventory();
    const fx = await fixture();
    const result = await recordReceivedLine(env.DB, lineCommand(fx, { acceptedDeltaBase: 4 }));
    expect(result).toMatchObject({
      ok: true,
      value: { acceptedBase: 4, rejectedBase: 0, remainingBase: 6, version: 2 },
    });
    expect(await record(fx.receivingRecordId)).toMatchObject({
      accepted_quantity: 4,
      status: "IN_PROGRESS",
      version: 2,
    });
    const evidence = await counts(fx.receivingRecordId);
    expect(evidence.events).toBe(1);
    expect(evidence.ledger).toBe(0);
    expect(evidence.allocations).toBe(1);
    expect(await balance()).toBeNull();
    expect(await allocation(fx)).toEqual({
      received_base: 4,
      packed_base: 0,
      surplus_released_base: 0,
      disposed_base: 0,
      version: 1,
    });
    const requirement = await env.DB.prepare(
      "SELECT status FROM procurement_requirement WHERE id=?",
    )
      .bind(fx.requirementId)
      .first<{ status: string }>();
    expect(requirement?.status).toBe("PARTIALLY_RECEIVED");
  });

  it("never turns rejected quantity into usable stock", async () => {
    await cleanInventory();
    const fx = await fixture();
    const result = await recordReceivedLine(
      env.DB,
      lineCommand(fx, { acceptedDeltaBase: 0, rejectedDeltaBase: 3, expectedVersion: 1 }),
    );
    expect(result).toMatchObject({ ok: true, value: { rejectedBase: 3, remainingBase: 7 } });
    const evidence = await counts(fx.receivingRecordId);
    expect(evidence.events).toBe(1);
    expect(evidence.ledger).toBe(0);
    expect(await balance()).toBe(null);
    expect(await allocation(fx)).toBeNull();
    expect(evidence.allocations).toBe(0);
    expect(await record(fx.receivingRecordId)).toMatchObject({ status: "DISCREPANCY" });
  });

  it("replays the same result for duplicate keys and conflicts on different payloads", async () => {
    const fx = await fixture();
    const attempt = lineCommand(fx);
    const first = await recordReceivedLine(env.DB, attempt);
    expect(first.ok).toBe(true);
    const replay = await recordReceivedLine(env.DB, attempt);
    expect(replay).toEqual(first);
    const conflict = await recordReceivedLine(env.DB, { ...attempt, acceptedDeltaBase: 2 });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(await counts(fx.receivingRecordId)).toEqual({ events: 1, ledger: 0, allocations: 1 });
  });

  it("allows exactly one winner for the last remaining quantity", async () => {
    await cleanInventory();
    const fx = await fixture({ expected: 10, accepted: 6, recordVersion: 1 });
    const a = lineCommand(fx, { acceptedDeltaBase: 4 });
    const b = lineCommand(fx, { acceptedDeltaBase: 4 });
    const [resultA, resultB] = await Promise.all([
      recordReceivedLine(env.DB, a),
      recordReceivedLine(env.DB, b),
    ]);
    const successes = [resultA, resultB].filter((result) => result.ok).length;
    expect(successes).toBe(1);
    expect(await record(fx.receivingRecordId)).toMatchObject({
      accepted_quantity: 10,
      rejected_quantity: 0,
      status: "COMPLETED",
      version: 2,
    });
    const requirement = await env.DB.prepare(
      "SELECT status FROM procurement_requirement WHERE id=?",
    )
      .bind(fx.requirementId)
      .first<{ status: string }>();
    expect(requirement?.status).toBe("RECEIVED");
    // Only the winning new receipt contributes cycle goods; historical totals are not inferred.
    expect(await balance()).toBeNull();
    expect(await allocation(fx)).toMatchObject({ received_base: 4 });
    expect(await counts(fx.receivingRecordId)).toEqual({ events: 1, ledger: 0, allocations: 1 });
    const ledgerRows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='RECEIVING_ACCEPTED'",
    )
      .bind(locationId, inventoryPoolId)
      .first<{ count: number }>();
    expect(ledgerRows?.count ?? 0).toBe(0);
  });
});
