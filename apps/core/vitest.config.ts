import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const migrationDir = fileURLToPath(new URL("./migrations", import.meta.url));
const migrations = await readD1Migrations(migrationDir);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        // The automated harness runs as the test environment so the fake
        // payment provider registers through the runtime construction point.
        bindings: { TEST_MIGRATIONS: JSON.stringify(migrations), ENVIRONMENT: "test" },
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
