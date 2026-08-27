import { defineConfig } from "@playwright/test";

/**
 * Operational Playwright flows run against a locally provisioned stack
 * (vinext web app with its CORE service binding). Start the stack before
 * invoking these tests:
 *
 *   pnpm --filter @freshmarkets/core dev      # Core worker
 *   pnpm --filter @freshmarkets/web dev       # Web app (APP_BASE_URL port)
 *
 * APP_BASE_URL overrides http://localhost:3000. Suites self-skip when the
 * stack is unreachable so repository-wide verification never fails on an
 * environment without a running app.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.APP_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
