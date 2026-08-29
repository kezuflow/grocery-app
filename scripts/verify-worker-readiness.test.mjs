import assert from "node:assert/strict";
import test from "node:test";
import { runReadinessChecks } from "./verify-worker-readiness.mjs";

test("readiness verifier reports local configuration checks without secrets", async () => {
  const result = await runReadinessChecks({ root: process.cwd(), probeLocal: false });

  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.name === "declared bindings" && check.ok));
  assert.ok(result.checks.some((check) => check.name === "migration verifier" && check.ok));
  assert.ok(result.checks.every((check) => !/bearer|token|secret/i.test(check.detail)));
});
