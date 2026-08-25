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
        bindings: { TEST_MIGRATIONS: JSON.stringify(migrations) },
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
