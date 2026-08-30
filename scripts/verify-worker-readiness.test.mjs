import assert from "node:assert/strict";
import test from "node:test";
import { probe, runCommand, runReadinessChecks } from "./verify-worker-readiness.mjs";

test("Windows pnpm launcher uses its JavaScript entrypoint without a shell and preserves output", () => {
  let invocation;
  const result = runCommand("C:/repo", "pnpm", ["test"], {
    platform: "win32",
    pnpmEntrypoint: () => "C:/tools/pnpm/bin/pnpm.mjs",
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 7, signal: null, stdout: "partial output", stderr: "failure detail" };
    },
  });

  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["C:/tools/pnpm/bin/pnpm.mjs", "test"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "partial output");
  assert.equal(result.stderr, "failure detail");
});

test("readiness verifier reports local configuration checks without secrets", async () => {
  const result = await runReadinessChecks({ root: process.cwd(), probeLocal: false });

  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.name === "declared bindings" && check.ok));
  assert.ok(result.checks.some((check) => check.name === "migration verifier" && check.ok));
  assert.ok(result.checks.every((check) => !/bearer|token|secret/i.test(check.detail)));
});

test("admin local smoke accepts the BFF unauthenticated envelope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: "UNAUTHENTICATED", requestId: "core-request-reference" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const result = await probe("http://127.0.0.1:3000", "/api/admin/context", "admin");
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness smoke requires critical dependency checks", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    const requestId = new Request(request, init).headers.get("x-request-id") ?? "missing";
    return Response.json(
      {
        status: "ready",
        checks: { database: "ready", paymentProvider: { status: "ready" } },
      },
      { headers: { "x-request-id": requestId } },
    );
  };
  try {
    const result = await probe("http://127.0.0.1:8787", "/ready", "readiness");
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
