import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async (context) => {
  const migrations = JSON.parse(
    (env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS,
  ) as Parameters<typeof applyD1Migrations>[1];
  const isDeliveryMigrationTest =
    context.task.file?.name.endsWith("delivery-map-migration.integration.test.ts") ||
    context.task.file?.name.includes("delivery-stop-id-");
  const selectedMigrations = isDeliveryMigrationTest
    ? migrations.filter((migration) => migration.name < "0043_delivery_batches_and_map_stops.sql")
    : migrations;
  await applyD1Migrations(env.DB, selectedMigrations);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO delivery_fee_configuration (id, market_id, location_id, currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at) VALUES ('test-fee-cebu-v1', 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000, 2500, 'ACTIVE', 1, 0, NULL, 0, 0)",
  ).run();
});
