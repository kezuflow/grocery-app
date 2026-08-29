import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { startReceiving, type StartReceivingCommand } from "./start-receiving";
import { recordReceivedLine, type RecordReceivedLineCommand } from "./record-received-line";

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
  const [events, ledger] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM receiving_event WHERE receiving_record_id=?")
      .bind(receivingRecordId)
      .first<{ count: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='RECEIVING_ACCEPTED'",
    )
      .bind(locationId, inventoryPoolId)
      .first<{ count: number }>(),
  ]);
  return { events: events?.count ?? 0, ledger: ledger?.count ?? 0 };
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
    const result = await startReceiving(env.DB, startCommand(fx));
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });
});

describe("record received line", () => {
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
      lineCommand(stale, { expectedVersion: 0 }),
    );
    expect(staleResult).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("commits one event, one ledger row, and exact totals for an accepted line", async () => {
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
    expect(evidence.ledger).toBe(1);
    expect(await balance()).toMatchObject({ on_hand: 4, version: 1 });
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
    expect(await counts(fx.receivingRecordId)).toEqual({ events: 1, ledger: 1 });
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
    // Inventory reflects only the single winning accepted event, never the
    // pre-seeded record totals or the losing command.
    expect(await balance()).toMatchObject({ on_hand: 4 });
    const ledgerRows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=? AND movement_type='RECEIVING_ACCEPTED'",
    )
      .bind(locationId, inventoryPoolId)
      .first<{ count: number }>();
    expect(ledgerRows?.count ?? 0).toBe(1);
  });
});
