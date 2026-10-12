const path = require("node:path");
const root = path.resolve(__dirname, "../../../..");
const existing = require(path.join(root, "apps/web/playwright.config.ts")).default;
if (process.env.E2E_START_STACK !== "1" || !process.env.FM_VERIFY_RUN_FILE) {
  throw new Error("Use node .agents/skills/verify-freshmarkets/scripts/run.mjs");
}
module.exports = {
  ...existing,
  testDir: __dirname,
  testMatch: "proof.spec.cjs",
  outputDir: path.join(process.env.FM_VERIFY_EVIDENCE, "browser"),
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(process.env.FM_VERIFY_EVIDENCE, "results.json") }],
  ],
  webServer: { ...existing.webServer, cwd: root },
  use: {
    ...existing.use,
    trace: "on",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
};
