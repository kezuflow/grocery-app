import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { adjustInventory, type AdjustInventoryCommand } from "./adjust-inventory";

const locationId = "location-cebu-central";
const inventoryPoolId = "pool-red-onion";

async function seedBalance(onHand: number, reserved = 0, version = 1) {
  await env.DB.prepare("DELETE FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?")
    .bind(locationId, inventoryPoolId)
    .run();
  await env.DB.prepare(
    "INSERT INTO inventory_balance (location_id, inventory_pool_id, on_hand, reserved, version) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(locationId, inventoryPoolId, onHand, reserved, version)
    .run();
}

async function balance() {
  return env.DB.prepare(
    "SELECT on_hand, reserved, version FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(locationId, inventoryPoolId)
    .first<{ on_hand: number; reserved: number; version: number }>();
}

async function ledgerCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE location_id=? AND inventory_pool_id=?",
  )
    .bind(locationId, inventoryPoolId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function succeededRecords(...keys: string[]) {
  if (keys.length === 0) return 0;
  const placeholders = keys.map(() => "?").join(",");
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM idempotency_records WHERE scope='inventory.adjust' AND idempotency_key IN (${placeholders}) AND status='SUCCEEDED'`,
  )
    .bind(...keys)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function command(overrides: Partial<AdjustInventoryCommand> = {}): AdjustInventoryCommand {
  return {
    requestId: crypto.randomUUID(),
    actorId: `actor-${crypto.randomUUID()}`,
    locationId,
    inventoryPoolId,
    deltaBase: 3,
    reason: "test-adjustment",
    expectedVersion: 1,
    idempotencyKey: `adjust-${crypto.randomUUID()}`,
    ...overrides,
  };
}

describe("atomic inventory adjustment", () => {
  it("rejects adjustments that would breach stock invariants without any mutation", async () => {
    await seedBalance(5);
    const ledgerBefore = await ledgerCount();
    const result = await adjustInventory(env.DB, command({ deltaBase: -6, expectedVersion: 1 }));
    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
    expect(await balance()).toMatchObject({ on_hand: 5, reserved: 0, version: 1 });
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it("rejects reserved quantities above on-hand", async () => {
    await seedBalance(5, 4);
    const result = await adjustInventory(env.DB, command({ deltaBase: -2, expectedVersion: 1 }));
    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
    expect(await balance()).toMatchObject({ on_hand: 5, reserved: 4, version: 1 });
  });

  it("rejects stale versions without any mutation", async () => {
    await seedBalance(5);
    const ledgerBefore = await ledgerCount();
    const result = await adjustInventory(env.DB, command({ deltaBase: 3, expectedVersion: 0 }));
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(await balance()).toMatchObject({ on_hand: 5, version: 1 });
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it("commits balance, ledger, and idempotency atomically and replays stably", async () => {
    await seedBalance(5);
    const ledgerBefore = await ledgerCount();
    const attempt = command({ deltaBase: 3, expectedVersion: 1 });
    const first = await adjustInventory(env.DB, attempt);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({
      locationId,
      inventoryPoolId,
      onHandBase: 8,
      reservedBase: 0,
      version: 2,
    });
    expect(first.value.ledgerEntryId).toBeTruthy();
    expect(await ledgerCount()).toBe(ledgerBefore + 1);
    expect(await succeededRecords(attempt.idempotencyKey)).toBe(1);

    const replay = await adjustInventory(env.DB, attempt);
    expect(replay).toEqual(first);
    expect(await ledgerCount()).toBe(ledgerBefore + 1);
    expect(await balance()).toMatchObject({ on_hand: 8, version: 2 });
  });

  it("rejects an idempotency key reused with a different payload", async () => {
    await seedBalance(5);
    const attempt = command({ deltaBase: 3, expectedVersion: 1 });
    await adjustInventory(env.DB, attempt);
    const conflict = await adjustInventory(env.DB, { ...attempt, deltaBase: 2 });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(await balance()).toMatchObject({ on_hand: 8, version: 2 });
  });

  it("creates a first balance row when expecting absence", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM inventory_balance WHERE location_id=? AND inventory_pool_id IN (?, ?)",
      ).bind(locationId, inventoryPoolId, "pool-eggs"),
    ]);
    const result = await adjustInventory(
      env.DB,
      command({ deltaBase: 5, expectedVersion: 0, inventoryPoolId: "pool-eggs" }),
    );
    expect(result).toMatchObject({ ok: true, value: { onHandBase: 5, version: 1 } });
  });

  it("allows exactly one winner among concurrent adjustments of the same version", async () => {
    await seedBalance(5);
    const a = command({ deltaBase: 2, expectedVersion: 1 });
    const b = command({ deltaBase: 2, expectedVersion: 1 });
    const [resultA, resultB] = await Promise.all([
      adjustInventory(env.DB, a),
      adjustInventory(env.DB, b),
    ]);
    const successes = [resultA, resultB].filter((result) => result.ok).length;
    expect(successes).toBe(1);
    expect(await balance()).toMatchObject({ on_hand: 7, version: 2 });
  });
});
