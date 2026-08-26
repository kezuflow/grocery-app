import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

type ReceivingEventInput = {
  acceptedDelta?: number;
  rejectedDelta?: number;
  idempotencyKey?: string;
};

async function insertEvent({
  acceptedDelta = 1,
  rejectedDelta = 0,
  idempotencyKey = `event-${crypto.randomUUID()}`,
}: ReceivingEventInput = {}): Promise<void> {
  const requirementId = `req-${crypto.randomUUID()}`;
  const receivingRecordId = `rec-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status) VALUES (?, 'cycle-next-cebu', 'location-cebu-central', 'pool-red-onion', 100, 'ORDERED')",
    ).bind(requirementId),
    env.DB.prepare(
      "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status) VALUES (?, ?, 100, 0, 0, 'PENDING')",
    ).bind(receivingRecordId, requirementId),
    env.DB.prepare(
      "INSERT INTO receiving_event (receiving_record_id, procurement_requirement_id, location_id, inventory_pool_id, accepted_delta, rejected_delta, reason, idempotency_key, occurred_at) VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', ?, ?, ?, ?, ?)",
    ).bind(
      receivingRecordId,
      requirementId,
      acceptedDelta,
      rejectedDelta,
      "migration-check",
      idempotencyKey,
      Date.now(),
    ),
  ]);
}

describe("receiving integrity migration", () => {
  it("creates the receiving_event table", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='receiving_event'",
    ).first<{ name: string }>();
    expect(row?.name).toBe("receiving_event");
  });

  it("rejects negative deltas and non-positive combined deltas", async () => {
    await expect(insertEvent({ acceptedDelta: -1, rejectedDelta: 0 })).rejects.toThrow();
    await expect(insertEvent({ acceptedDelta: 0, rejectedDelta: -2 })).rejects.toThrow();
    await expect(insertEvent({ acceptedDelta: 0, rejectedDelta: 0 })).rejects.toThrow();
  });

  it("enforces unique command idempotency identity per event", async () => {
    await insertEvent({ acceptedDelta: 1, rejectedDelta: 0, idempotencyKey: "receive-1" });
    await expect(
      insertEvent({ acceptedDelta: 1, rejectedDelta: 0, idempotencyKey: "receive-1" }),
    ).rejects.toThrow();
  });

  it("keeps the only 0015 migration as the receiving integrity migration", async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name LIKE '0015%' ORDER BY name",
    ).all<{ name: string }>();
    expect(row.results.map((entry) => entry.name)).toEqual([
      "0015_inventory_receiving_integrity.sql",
    ]);
  });
});
