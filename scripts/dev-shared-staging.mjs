import { spawn } from "node:child_process";

process.stderr.write(`
WARNING: shared staging development is an explicit, read-oriented mode.
- Remote data: freshmarkets-core-staging D1 and freshmarkets-product-media-staging R2.
- Disabled in this local process: email sending, queues, cron, PayMongo, and delivery providers.
- Still possible: any write mutates shared staging data, and the deployed staging Core may consume
  notification outbox rows written to that D1. Do not use ordinary customer/staff mutations here.

`);

const childEnvironment = { ...process.env, FRESHMARKETS_DEV_DATA: "shared-staging" };
delete childEnvironment.CLOUDFLARE_ENV;
const child = spawn("pnpm", ["dev:web"], {
  env: childEnvironment,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  process.stderr.write(`Unable to start shared staging development: ${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
