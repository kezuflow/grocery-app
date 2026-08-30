import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

const migrationName = "0043_delivery_batches_and_map_stops.sql";

it("allocates compact stable stop ids when the legacy stop table is empty", async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES ('job-empty-a', 'order-empty-a', NULL, 'INSTANT', NULL, 'UNASSIGNED', '{}', NULL, 1, 1, 1)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES ('job-empty-b', 'order-empty-b', NULL, 'INSTANT', NULL, 'UNASSIGNED', '{}', NULL, 1, 1, 1)",
    ),
  ]);

  const migrations = JSON.parse(
    (env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS,
  ) as Parameters<typeof applyD1Migrations>[1];
  await applyD1Migrations(env.DB, [
    migrations.find((candidate) => candidate.name === migrationName)!,
  ]);

  const stops = await env.DB.prepare(
    "SELECT id, delivery_job_id FROM delivery_stop ORDER BY delivery_job_id",
  ).all<{ id: string; delivery_job_id: string }>();
  expect(stops.results).toEqual([
    { id: "generated-stop-1-1", delivery_job_id: "job-empty-a" },
    { id: "generated-stop-1-2", delivery_job_id: "job-empty-b" },
  ]);
  expect(new Set(stops.results.map((stop) => stop.id)).size).toBe(2);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM delivery_stop_compatibility_history",
    ).first<{
      count: number;
    }>(),
  ).toEqual({ count: 0 });
});
