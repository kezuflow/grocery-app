import { defineConfig } from "@playwright/test";

const managedStack = process.env.E2E_START_STACK === "1";
const managedPort = 3100;
const baseURL = managedStack
  ? `http://localhost:${managedPort}`
  : (process.env.APP_BASE_URL ?? "http://localhost:3000");

/**
 * Operational Playwright flows run against a locally provisioned stack
 * (vinext web app with its CORE service binding). Start the stack before
 * invoking these tests:
 *
 *   pnpm --filter @freshmarkets/core dev      # Core worker
 *   pnpm --filter @freshmarkets/web dev       # Web app (APP_BASE_URL port)
 *
 * APP_BASE_URL overrides http://localhost:3000. Set E2E_START_STACK=1 to
 * build, migrate, and start the deterministic local stack. Core then runs in
 * its test environment, where auth email uses the existing no-op test adapter;
 * production and ordinary development remain fail-closed.
 *
 * The managed stack deliberately uses the pre-4.114 Wrangler proxy controller
 * because newer local controllers can exit on a transient proxy disconnect.
 * Its workerd binary is independently pinned to the current compatibility-date
 * build through pnpm overrides; production and build tooling remain on the
 * repository's current Wrangler version.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: managedStack ? 1 : 0,
  workers: managedStack ? 1 : undefined,
  reporter: [["list"]],
  webServer: managedStack
    ? {
        command: `pnpm --filter @freshmarkets/web build && node apps/web/tests/prepare-admin-e2e-state.mjs && pnpm --filter @freshmarkets/core exec wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e-state && node apps/web/node_modules/wrangler-e2e/bin/wrangler.js dev -c apps/web/dist/server/wrangler.json -c apps/core/wrangler.e2e.jsonc --persist-to apps/core/.wrangler/e2e-state --port ${managedPort}`,
        cwd: "../..",
        env: { ...process.env, E2E_AUTHENTICATED: "1" },
        port: managedPort,
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
});
