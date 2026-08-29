import assert from "node:assert/strict";
import test from "node:test";
import { probe, runReadinessChecks } from "./verify-worker-readiness.mjs";

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
