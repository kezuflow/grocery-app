import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("commerce write concurrency", () => {
  it("allows only one capacity allocation at the limit", async () => {
    const cycleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO delivery_cycle (id, market_id, name, order_opens_at, cutoff_at, delivery_date, status, capacity, allocated, version) VALUES (?, 'market-metro-cebu', 'Concurrency cycle', ?, ?, ?, 'OPEN', 1, 0, 1)",
    )
      .bind(cycleId, Date.now() - 1000, Date.now() + 60_000, Date.now() + 120_000)
      .run();
    await env.DB.prepare(
      "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES (?, 'zone-cebu-city-core', 'location-cebu-central', 1, 0, 1)",
    )
      .bind(cycleId)
      .run();

    const results = await Promise.all([
      env.DB.prepare(
        "UPDATE cycle_zone_capacity SET allocated=allocated+1, version=version+1 WHERE cycle_id=? AND zone_id='zone-cebu-city-core' AND location_id='location-cebu-central' AND allocated < capacity",
      )
        .bind(cycleId)
        .run(),
      env.DB.prepare(
        "UPDATE cycle_zone_capacity SET allocated=allocated+1, version=version+1 WHERE cycle_id=? AND zone_id='zone-cebu-city-core' AND location_id='location-cebu-central' AND allocated < capacity",
      )
        .bind(cycleId)
        .run(),
    ]);
    expect(results.map((result) => result.meta.changes).sort()).toEqual([0, 1]);
    await expect(
      env.DB.prepare(
        "SELECT allocated FROM cycle_zone_capacity WHERE cycle_id=? AND zone_id='zone-cebu-city-core' AND location_id='location-cebu-central'",
      )
        .bind(cycleId)
        .first(),
    ).resolves.toMatchObject({ allocated: 1 });
  });

  it("allows only available stocked inventory to be reserved", async () => {
    const poolId = "pool-red-onion";
    await env.DB.prepare(
      "UPDATE inventory_balance SET on_hand=10, reserved=0 WHERE location_id='location-cebu-central' AND inventory_pool_id=?",
    )
      .bind(poolId)
      .run();
    const results = await Promise.all([
      env.DB.prepare(
        "UPDATE inventory_balance SET reserved=reserved+7, version=version+1 WHERE location_id='location-cebu-central' AND inventory_pool_id=? AND on_hand-reserved>=7",
      )
        .bind(poolId)
        .run(),
      env.DB.prepare(
        "UPDATE inventory_balance SET reserved=reserved+7, version=version+1 WHERE location_id='location-cebu-central' AND inventory_pool_id=? AND on_hand-reserved>=7",
      )
        .bind(poolId)
        .run(),
    ]);
    expect(results.map((result) => result.meta.changes).sort()).toEqual([0, 1]);
    await expect(
      env.DB.prepare(
        "SELECT reserved FROM inventory_balance WHERE location_id='location-cebu-central' AND inventory_pool_id=?",
      )
        .bind(poolId)
        .first(),
    ).resolves.toMatchObject({ reserved: 7 });
  });
});
