import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationDir = fileURLToPath(new URL("./migrations", import.meta.url));
const migrations = await readD1Migrations(migrationDir);
// Read on the Node side of config load; workerd cannot stat the host tree.
const produceAssetKeys = readdirSync(
  fileURLToPath(new URL("../web/public/produce", import.meta.url)),
)
  .filter((name) => name.endsWith(".webp"))
  .sort();
process.env.GOOGLE_MAPS_SERVER_KEY ??= "test-placeholder";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        // The automated harness runs as the test environment so the mock
        // payment provider registers through the runtime construction point.
        bindings: {
          TEST_MIGRATIONS: JSON.stringify(migrations),
          PRODUCE_ASSET_KEYS: JSON.stringify(produceAssetKeys),
          ENVIRONMENT: "test",
          INITIAL_GLOBAL_ADMIN_EMAIL: "initial-admin@example.com",
          PAYMENT_PROVIDER: "mock",
          DELIVERY_PROVIDERS: "lalamove",
          LOCAL_DELIVERY_PROVIDER: "mock",
          LALAMOVE_MARKET: "PH",
          LALAMOVE_LANGUAGE: "en_PH",
          LALAMOVE_SERVICE_TYPE: "MOTORCYCLE",
          LALAMOVE_API_KEY: "pk_test_fixture",
          LALAMOVE_API_SECRET: "sk_test_fixture",
          ROUTE_DISTANCE_PROVIDER: "mock",
          GOOGLE_MAPS_SERVER_KEY: "test-placeholder",
        },
      },
    }),
  ],
  test: {
    // Bound concurrent workerd instances: each integration file creates and
    // upgrades the full D1 schema. Unbounded parallel runs can exhaust the host.
    maxWorkers: 2,
    // Migration-heavy Worker/D1 integration fixtures can approach Vitest's
    // five-second default under full-suite parallel load; retain a bounded
    // timeout without making those checks scheduler-sensitive.
    testTimeout: 10_000,
    typecheck: {
      enabled: false,
    },
    setupFiles: ["./src/test-setup.ts"],
  },
});
