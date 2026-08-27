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
process.env.MAPBOX_ACCESS_TOKEN ??= "test-placeholder";

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
          ROUTE_DISTANCE_PROVIDER: "mock",
          MAPBOX_ACCESS_TOKEN: "test-placeholder",
        },
      },
    }),
  ],
  test: {
    typecheck: {
      enabled: false,
    },
    setupFiles: ["./src/test-setup.ts"],
  },
});
