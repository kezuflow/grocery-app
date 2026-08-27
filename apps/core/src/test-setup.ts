import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await applyD1Migrations(
    env.DB,
    JSON.parse((env as unknown as { TEST_MIGRATIONS: string }).TEST_MIGRATIONS) as Parameters<
      typeof applyD1Migrations
    >[1],
  );
  await env.DB.prepare(
    "INSERT OR IGNORE INTO delivery_fee_configuration (id, market_id, location_id, currency, minimum_delivery_fee_minor, per_kilometer_rate_minor, status, version, effective_from, effective_to, created_at, updated_at) VALUES ('test-fee-cebu-v1', 'market-metro-cebu', 'location-cebu-central', 'PHP', 5000, 2500, 'ACTIVE', 1, 0, NULL, 0, 0)",
  ).run();
});
