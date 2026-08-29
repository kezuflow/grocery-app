import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
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

function runCommand(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return {
    ok: result.status === 0,
    detail:
      result.status === 0
        ? "completed"
        : `exit=${result.status ?? "unknown"}${result.signal ? ` signal=${result.signal}` : ""}`,
  };
}

async function probe(url, expectedPath) {
  const requestId = `worker-readiness-${Date.now()}`;
  try {
    const response = await fetch(new URL(expectedPath, url), {
      headers: { "x-request-id": requestId },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const returnedRequestId = response.headers.get("x-request-id");
    const body = await response.json();
    const structured = body && typeof body === "object" && !Array.isArray(body);
    return check(
      `${expectedPath} local smoke`,
      response.ok &&
        contentType.includes("application/json") &&
        returnedRequestId === requestId &&
        structured,
      response.ok ? "structured JSON and request reference returned" : `HTTP ${response.status}`,
    );
  } catch (error) {
    return check(
      `${expectedPath} local smoke`,
      false,
      `unreachable (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
}

export async function runReadinessChecks({ root = process.cwd(), probeLocal = false } = {}) {
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

  if (probeLocal) {
    const coreUrl = process.env.FRESHMARKETS_CORE_URL ?? "http://127.0.0.1:8787";
    const webUrl = process.env.FRESHMARKETS_WEB_URL ?? "http://127.0.0.1:3000";
    checks.push(await probe(coreUrl, "/health"));
    checks.push(await probe(webUrl, "/api/core-health"));
    checks.push(await probe(webUrl, "/api/admin/context"));
  }

  return { ok: checks.every((item) => item.ok), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const probeLocal = process.argv.includes("--probe-local");
  const result = await runReadinessChecks({ probeLocal });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
