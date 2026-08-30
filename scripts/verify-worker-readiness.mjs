import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

async function read(root, file) {
  return readFile(join(root, file), "utf8");
}

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));
}

function resolvePnpmEntrypoint() {
  const corepackEntrypoint = join(
    dirname(process.execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (existsSync(corepackEntrypoint)) return corepackEntrypoint;
  const located = spawnSync("where.exe", ["pnpm.cmd"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  for (const shim of (located.stdout ?? "").split(/\r?\n/).filter(Boolean)) {
    const entrypoint = join(dirname(shim), "node_modules", "pnpm", "bin", "pnpm.mjs");
    if (existsSync(entrypoint)) return entrypoint;
  }
  throw new Error("PNPM_JAVASCRIPT_ENTRYPOINT_NOT_FOUND");
}

export function runCommand(
  root,
  command,
  args,
  { platform = process.platform, spawn = spawnSync, pnpmEntrypoint = resolvePnpmEntrypoint } = {},
) {
  const windowsPnpm = platform === "win32" && command === "pnpm";
  const executable = windowsPnpm ? process.execPath : command;
  const executableArgs = windowsPnpm ? [pnpmEntrypoint(), ...args] : args;
  const result = spawn(executable, executableArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    shell: false,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    detail:
      result.status === 0
        ? "completed"
        : `exit=${result.status ?? "unknown"}${result.signal ? ` signal=${result.signal}` : ""}`,
  };
}

export async function probe(url, expectedPath, mode = "health") {
  const requestId = `worker-readiness-${Date.now()}`;
  try {
    const response = await fetch(new URL(expectedPath, url), {
      headers: { "x-request-id": requestId },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const returnedRequestId = response.headers.get("x-request-id");
    const body = await response.json();
    const structured = body && typeof body === "object" && !Array.isArray(body);
    const adminError =
      mode === "admin" &&
      response.ok &&
      body?.ok === false &&
      body?.error?.code === "UNAUTHENTICATED" &&
      typeof body?.error?.requestId === "string" &&
      body.error.requestId.length > 0;
    const dependencyReady =
      mode === "readiness" &&
      response.ok &&
      body?.status === "ready" &&
      body?.checks?.database === "ready" &&
      body?.checks?.paymentProvider?.status === "ready";
    const healthyResponse =
      response.ok &&
      contentType.includes("application/json") &&
      structured &&
      (mode !== "readiness" || dependencyReady);
    const requestReference = mode === "admin" ? adminError : returnedRequestId === requestId;
    return check(
      `${expectedPath} local smoke`,
      healthyResponse && requestReference,
      adminError
        ? "unauthenticated structured error envelope returned"
        : healthyResponse && requestReference
          ? "structured JSON and request reference returned"
          : `unexpected response (HTTP ${response.status})`,
    );
  } catch (error) {
    return check(
      `${expectedPath} local smoke`,
      false,
      `unreachable (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
}

export async function runReadinessChecks({
  root = process.cwd(),
  probeLocal = false,
  dryRun = false,
} = {}) {
  const checks = [];
  const coreConfig = parseJsonc(await read(root, "apps/core/wrangler.jsonc"));
  const webConfig = parseJsonc(await read(root, "apps/web/wrangler.jsonc"));
  const coreBindings = new Set([
    ...(coreConfig.d1_databases ?? []).map((entry) => entry.binding),
    ...(coreConfig.send_email ?? []).map((entry) => entry.name),
  ]);
  const webBindings = new Set((webConfig.services ?? []).map((entry) => entry.binding));
  checks.push(
    check(
      "declared bindings",
      coreBindings.has("DB") && coreBindings.has("EMAIL") && webBindings.has("CORE"),
      "Core DB/EMAIL and Web CORE are declared",
    ),
  );

  const migration = runCommand(root, process.execPath, ["scripts/verify-migrations.mjs"]);
  checks.push(check("migration verifier", migration.ok, migration.detail));

  if (dryRun) {
    const workerBuild = runCommand(root, "pnpm", ["--filter", "@freshmarkets/core", "build"]);
    checks.push(check("Core Wrangler dry-run", workerBuild.ok, workerBuild.detail));
  }

  if (probeLocal) {
    const coreUrl = process.env.FRESHMARKETS_CORE_URL ?? "http://127.0.0.1:8787";
    const webUrl = process.env.FRESHMARKETS_WEB_URL ?? "http://127.0.0.1:3000";
    checks.push(await probe(coreUrl, "/health"));
    checks.push(await probe(coreUrl, "/ready", "readiness"));
    checks.push(await probe(webUrl, "/api/core-health"));
    checks.push(await probe(webUrl, "/api/admin/context", "admin"));
  }

  return { ok: checks.every((item) => item.ok), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const probeLocal = process.argv.includes("--probe-local");
  const dryRun = process.argv.includes("--dry-run");
  const result = await runReadinessChecks({ probeLocal, dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
