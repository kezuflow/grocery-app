import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeSecuritySource,
  verifyObservabilityConfig,
  verifyReadinessSurface,
} from "./verify-readiness-security.mjs";

test("rejects sensitive fields in structured log calls", () => {
  assert.deepEqual(
    analyzeSecuritySource(
      "apps/core/src/orders/application/bad.ts",
      'log("info", "unsafe", { requestId, actionUrl });',
    )[0],
    {
      code: "SENSITIVE_LOG_FIELD",
      file: "apps/core/src/orders/application/bad.ts",
      line: 1,
      message: "Sensitive field actionUrl must not be passed to log()",
    },
  );
});

test("rejects direct console logging outside closed telemetry modules", () => {
  assert.equal(
    analyzeSecuritySource(
      "apps/core/src/orders/application/bad.ts",
      "console.log(JSON.stringify({ requestId }));",
    )[0]?.code,
    "DIRECT_CONSOLE",
  );
});

test("accepts safe structured fields and the closed financial boundary", () => {
  assert.deepEqual(
    analyzeSecuritySource(
      "apps/core/src/orders/application/good.ts",
      'log("warn", "order.failed", { requestId, aggregateId, outcomeCode });',
    ),
    [],
  );
  assert.deepEqual(
    analyzeSecuritySource(
      "apps/core/src/payments/application/financial-observability.ts",
      "console.info(JSON.stringify(output));",
    ),
    [],
  );
});

test("requires distinct liveness and readiness surfaces", () => {
  assert.deepEqual(
    verifyReadinessSurface(
      new Map([
        ["packages/contracts/src/common.ts", "type CoreReadinessResponse = {}"],
        ["packages/contracts/src/core-service.ts", 'const methods = ["readiness"]'],
        ["apps/core/src/index.ts", 'path === "/health"; path === "/ready"'],
        ["apps/core/src/runtime/readiness.ts", 'db.prepare("SELECT 1 AS ready")'],
      ]),
    ),
    [],
  );
  assert.ok(verifyReadinessSurface(new Map()).length >= 5);
});

test("requires explicit Worker log and trace sampling", () => {
  assert.deepEqual(
    verifyObservabilityConfig(
      JSON.stringify({
        observability: {
          enabled: true,
          logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 },
          traces: { enabled: true, head_sampling_rate: 0.05 },
        },
      }),
      "worker",
    ),
    [],
  );
  assert.equal(
    verifyObservabilityConfig(
      JSON.stringify({ observability: { enabled: true, head_sampling_rate: 1 } }),
      "worker",
    ).length,
    1,
  );
});
