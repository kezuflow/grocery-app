import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function listenerInfo(port) {
  const script = `$connection = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($connection) { $ownerId = $connection.OwningProcess; $ancestors = @(); $currentId = $ownerId; for ($i = 0; $i -lt 20 -and $currentId -gt 0; $i++) { $ancestors += $currentId; $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId"; if (-not $proc) { break }; $currentId = $proc.ParentProcessId }; @{ pid=$ownerId; ancestors=$ancestors } | ConvertTo-Json -Compress }; exit 0`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" },
  ).trim();
  return output ? JSON.parse(output) : null;
}

export async function doctor(runFile) {
  const run = JSON.parse(await readFile(runFile, "utf8"));
  const url = new URL(run.baseURL);
  assert.equal(url.hostname, "localhost");
  assert.equal(url.protocol, "http:");
  assert.match(run.stateName, /^e2e-verify-[a-f0-9-]+$/);
  const listener = listenerInfo(Number(url.port));
  assert(
    listener?.ancestors.includes(run.ownerPid),
    "Listener is not owned by this verification run",
  );
  const response = await fetch(new URL("/api/core-health", url), {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.service, "core");
  assert.equal(health.status, "ok");
  assert.equal(health.environment, "development");
  assert.equal(health.databaseBindingConfigured, true);
  assert.equal(typeof health.contractVersion, "string");
  return {
    runId: run.runId,
    baseURL: run.baseURL,
    revision: run.revision,
    listenerPid: listener.pid,
    health,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await doctor(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
