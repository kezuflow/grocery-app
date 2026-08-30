import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

const migrationName = "0043_delivery_batches_and_map_stops.sql";
const nearLimitLength = 900_000;

it("allocates bounded ids around adversarial legacy names and independent large ids", async () => {
  const largeJobId = "z".repeat(nearLimitLength);
  const largeStopId = "y".repeat(nearLimitLength);
  await env.DB.batch([
    ...[
      ["job-a", "order-a"],
      ["job-z", "order-z"],
      [largeJobId, "order-large-job"],
      ["legacy-job-one", "order-legacy-one"],
      ["legacy-job-two", "order-legacy-two"],
      ["legacy-job-large-stop", "order-legacy-large-stop"],
    ].map(([jobId, orderId]) =>
      env.DB.prepare(
        "INSERT INTO delivery_job (id, order_id, cycle_id, fulfillment_mode, rider_user_id, status, address_snapshot_json, delivered_at, version, created_at, updated_at) VALUES (?, ?, NULL, 'INSTANT', NULL, 'UNASSIGNED', '{}', NULL, 1, 1, 1)",
      ).bind(jobId, orderId),
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, batch_id, delivery_job_id, sequence, status, proof_json, version) VALUES ('generated-stop-1-1', NULL, 'legacy-job-one', NULL, 'UNASSIGNED', '{\"legacy\":1}', 1)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, batch_id, delivery_job_id, sequence, status, proof_json, version) VALUES ('generated-stop-2-1', NULL, 'legacy-job-two', NULL, 'UNASSIGNED', '{\"legacy\":2}', 1)",
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, batch_id, delivery_job_id, sequence, status, proof_json, version) VALUES (?, NULL, 'legacy-job-large-stop', NULL, 'UNASSIGNED', '{\"legacy\":\"large\"}', 1)",
    ).bind(largeStopId),
  ]);

  const migrations = JSON.parse(
    (env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS,
  ) as Parameters<typeof applyD1Migrations>[1];
  await applyD1Migrations(env.DB, [
    migrations.find((candidate) => candidate.name === migrationName)!,
  ]);

  const compactStops = await env.DB.prepare(
    "SELECT id, delivery_job_id FROM delivery_stop WHERE delivery_job_id IN ('job-a','job-z') ORDER BY delivery_job_id",
  ).all<{ id: string; delivery_job_id: string }>();
  expect(compactStops.results).toEqual([
    { id: "generated-stop-3-1", delivery_job_id: "job-a" },
    { id: "generated-stop-3-2", delivery_job_id: "job-z" },
  ]);
  const largeJobStop = await env.DB.prepare(
    "SELECT id, length(id) AS id_length, length(delivery_job_id) AS job_id_length FROM delivery_stop WHERE delivery_job_id=?",
  )
    .bind(largeJobId)
    .first<{ id: string; id_length: number; job_id_length: number }>();
  expect(largeJobStop).toEqual({
    id: "generated-stop-3-3",
    id_length: 18,
    job_id_length: nearLimitLength,
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM delivery_stop WHERE id IN ('generated-stop-1-1','generated-stop-2-1')",
    ).first<{ count: number }>(),
  ).toEqual({ count: 2 });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count, MAX(length(delivery_stop_id)) AS max_id_length FROM delivery_stop_compatibility_history",
    ).first<{ count: number; max_id_length: number }>(),
  ).toEqual({ count: 3, max_id_length: nearLimitLength });
});
