import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { listenerInfo } from "./doctor.mjs";

assert.equal(process.platform, "win32", "This proven runner uses Windows process ownership checks");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const runId = randomUUID();
const stateName = `e2e-verify-${runId}`;
const statePath = resolve(root, "apps/core/.wrangler", stateName);
assert.equal(dirname(statePath), resolve(root, "apps/core/.wrangler"));
try {
  await access(statePath);
  throw new Error("Refusing to reset existing state");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const port = 3187;
await new Promise((resolveReady, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, () => probe.close(resolveReady));
});
const evidence = join(root, ".wrangler/verify-freshmarkets", runId);
await mkdir(evidence, { recursive: true });
const runFile = join(evidence, "run.json");
const run = {
  runId,
  ownerPid: process.pid,
  baseURL: `http://localhost:${port}`,
  stateName,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(),
  workingTreeScope: execFileSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean),
  startedAt: new Date().toISOString(),
};
await writeFile(runFile, JSON.stringify(run, null, 2));
process.stdout.write(`Evidence directory ${evidence}\n`);
const stdout = createWriteStream(join(evidence, "stdout.log"));
const stderr = createWriteStream(join(evidence, "stderr.log"));
const child = spawn(
  process.execPath,
  [
    join(root, "apps/web/node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    join(root, ".agents/skills/verify-freshmarkets/scripts/playwright.config.cjs"),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      E2E_START_STACK: "1",
      E2E_STATE_NAME: stateName,
      E2E_PORT: String(port),
      E2E_PROVIDER_GATEWAY: "0",
      FM_VERIFY_RUN_FILE: runFile,
      FM_VERIFY_EVIDENCE: evidence,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (chunk) => {
  stdout.write(chunk);
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr.write(chunk);
  process.stderr.write(chunk);
});
let code = 1;
try {
  code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolveExit(status ?? 1));
  });
} finally {
  stdout.end();
  stderr.end();
  await Promise.all([finished(stdout), finished(stderr)]);
  const cleanup = {
    runId,
    listenerStopped: false,
    disposableStateRemoved: false,
    evidencePreserved: false,
    exitCode: code,
  };
  try {
    let listener = listenerInfo(port);
    if (listener?.ancestors.includes(process.pid)) {
      execFileSync("taskkill.exe", ["/PID", String(listener.pid), "/T", "/F"], { stdio: "ignore" });
      listener = listenerInfo(port);
    }
    assert.equal(
      listener,
      null,
      "Verification port still has a listener; investigate ownership before cleanup",
    );
    cleanup.listenerStopped = true;
    await rm(statePath, { recursive: true, force: true });
    cleanup.disposableStateRemoved = true;
    await access(runFile);
    cleanup.evidencePreserved = true;
  } catch (error) {
    cleanup.error = error.message;
    throw error;
  } finally {
    cleanup.completedAt = new Date().toISOString();
    await writeFile(join(evidence, "cleanup.json"), JSON.stringify(cleanup, null, 2));
  }
  process.stdout.write(`Cleanup complete. Evidence preserved at ${evidence}\n`);
}
process.exitCode = code;
