import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreStateRoot = fileURLToPath(new URL("../../core/.wrangler", import.meta.url));
const e2eStateName = process.env.E2E_STATE_NAME ?? "e2e-state";
if (!/^e2e-[a-z0-9-]+$/.test(e2eStateName)) throw new Error("Invalid E2E_STATE_NAME");
const e2eStateDirectory = resolve(coreStateRoot, e2eStateName);

if (dirname(e2eStateDirectory) !== resolve(coreStateRoot)) {
  throw new Error("Refusing to prepare an E2E state directory outside apps/core/.wrangler");
}

await rm(e2eStateDirectory, { recursive: true, force: true });
await mkdir(e2eStateDirectory, { recursive: true });
