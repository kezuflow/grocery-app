import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

async function emulateDeployedPre0043DeliverySchema(): Promise<void> {
  // Migration 0021 now repairs the delivery_job order FK for future installs.
  // Databases deployed before that repair did not have the FK, so the 0043
  // compatibility tests need the historical schema in order to seed every
  // malformed-but-schema-valid legacy row that the migration must preserve.
  const statements = [
    "DROP TABLE delivery_stop",
    "DROP TABLE delivery_job",
    `CREATE TABLE delivery_job (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      cycle_id TEXT,
      fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
      rider_user_id TEXT,
      status TEXT NOT NULL,
      address_snapshot_json TEXT NOT NULL,
      delivered_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      CHECK ((fulfillment_mode = 'SCHEDULED') = (cycle_id IS NOT NULL))
    )`,
    `CREATE TABLE delivery_stop (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES delivery_batch(id),
      delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id),
      sequence INTEGER,
      status TEXT NOT NULL,
      proof_json TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(batch_id, sequence)
    )`,
    `CREATE TRIGGER delivery_job_canonical_status_insert
    BEFORE INSERT ON delivery_job
    WHEN NEW.status NOT IN (
      'UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED',
      'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED'
    )
    BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END`,
    `CREATE TRIGGER delivery_job_canonical_status_update
    BEFORE UPDATE OF status ON delivery_job
    WHEN NEW.status NOT IN (
      'UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED',
      'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED'
    )
    BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END`,
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

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
  if (isDeliveryMigrationTest) {
    await emulateDeployedPre0043DeliverySchema();
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO delivery_fee_configuration (id, market_id, location_id, currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at) VALUES ('test-fee-cebu-v1', 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000, 2500, 'ACTIVE', 1, 0, NULL, 0, 0)",
  ).run();
});
