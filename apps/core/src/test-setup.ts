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
    : context.task.file?.name.endsWith("schema-upgrade.integration.test.ts")
      ? migrations.filter((migration) => migration.name < "0069_schema_integrity.sql")
      : migrations;
  await applyD1Migrations(env.DB, selectedMigrations);
  if (
    selectedMigrations.some((migration) => migration.name === "0082_delivery_cycle_schedule.sql")
  ) {
    // Explicit disposable fixture configuration; retained upgrades invent no scheduling facts.
    await env.DB.batch([
      env.DB
        .prepare(`INSERT OR IGNORE INTO delivery_cycle_schedule(cycle_id,timezone,procurement_at,preparation_at,pickup_at,created_at,updated_at)
        SELECT id,'Asia/Manila',cutoff_at,delivery_date-3600000,delivery_date,0,0 FROM delivery_cycle WHERE id='cycle-next-cebu'`),
      env.DB
        .prepare(`INSERT OR IGNORE INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at)
        SELECT 'window-test-cebu',id,'Test delivery window',delivery_date+3600000,delivery_date+10800000,0 FROM delivery_cycle WHERE id='cycle-next-cebu'`),
    ]);
  }
  if (isDeliveryMigrationTest) {
    await emulateDeployedPre0043DeliverySchema();
  }
  if (
    selectedMigrations.some(
      (migration) => migration.name === "0083_location_operating_schedule.sql",
    )
  ) {
    // Synthetic commerce fixtures explicitly operate all week. No retained migration invents hours.
    await env.DB.prepare(`INSERT OR IGNORE INTO location_operating_schedule(location_id,timezone,definition_json,updated_at)
      SELECT l.id,m.timezone,?,0 FROM fulfillment_location l JOIN market m ON m.id=l.market_id`)
      .bind(
        JSON.stringify({
          weekly: Array.from({ length: 7 }, (_, index) => ({
            dayOfWeek: index + 1,
            opensMinute: 0,
            closesMinute: 1440,
          })),
          closures: [],
        }),
      )
      .run();
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO delivery_fee_configuration (id, market_id, location_id, currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at) VALUES ('test-fee-cebu-v1', 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000, 2500, 'ACTIVE', 1, 0, NULL, 0, 0)",
  ).run();
  const hasDeliveryProfile = await env.DB.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='fulfillment_location_delivery_profile'",
  ).first<{ present: number }>();
  if (hasDeliveryProfile) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO fulfillment_location_delivery_profile
       (location_id,sender_name,phone_e164,email,formatted_address,address_line1,address_line2,
        barangay,city,region,postal_code,country_code,pickup_instructions,version,created_at,updated_at)
       VALUES ('location-cebu-central','FreshMarkets Central Cebu','+639171110000',NULL,
               'FreshMarkets Central Cebu, Cebu City, Philippines','FreshMarkets Central Cebu',NULL,
               NULL,'Cebu City','Central Visayas','6000','PH',NULL,1,0,0)`,
    ).run();
  }
});
