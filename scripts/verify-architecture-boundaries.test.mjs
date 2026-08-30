import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSourceFile } from "./verify-architecture-boundaries.mjs";

const violation = (fileName, sourceText) => analyzeSourceFile(fileName, sourceText)[0];

test("rejects Web imports from Core source", () => {
  assert.deepEqual(
    violation("apps/web/lib/bad.ts", 'import { query } from "../../core/src/orders/query";'),
    {
      code: "WEB_IMPORTS_CORE",
      file: "apps/web/lib/bad.ts",
      line: 1,
      message:
        "Web source must communicate with Core through shared contracts and Service Bindings",
    },
  );
});

test("rejects contract imports from infrastructure", () => {
  assert.equal(
    violation(
      "packages/contracts/src/bad.ts",
      'import type { D1Database } from "@cloudflare/workers-types";',
    ).code,
    "CONTRACT_IMPORTS_INFRASTRUCTURE",
  );
});

test("rejects outward imports from domain", () => {
  assert.equal(
    violation(
      "apps/core/src/orders/domain/order.ts",
      'import { placeOrder } from "../application/place-order";',
    ).code,
    "DOMAIN_IMPORTS_OUTWARD",
  );
});

test("rejects transport imports from application", () => {
  assert.equal(
    violation(
      "apps/core/src/orders/application/place-order.ts",
      'import { jsonResponse } from "../../http/response";',
    ).code,
    "APPLICATION_IMPORTS_TRANSPORT",
  );
});

test("rejects payment-provider adapters outside Payments", () => {
  assert.equal(
    violation(
      "apps/core/src/orders/application/place-order.ts",
      'import { XenditAdapter } from "../../payments/infrastructure/providers/xendit";',
    ).code,
    "PROVIDER_LEAK",
  );
});

test("allows the explicit runtime provider-readiness composition root", () => {
  assert.deepEqual(
    analyzeSourceFile(
      "apps/core/src/runtime/readiness.ts",
      'import { buildProviderRegistry } from "../payments/infrastructure/providers/runtime-providers";',
    ),
    [],
  );
});

test("rejects SQL execution from entrypoint composition", () => {
  assert.equal(
    violation(
      "apps/core/src/entrypoint/orders-rpc.ts",
      'export const rpc = (db) => db.prepare("SELECT * FROM grocery_order");',
    ).code,
    "ENTRYPOINT_SQL",
  );
});

test("rejects exported contract row types", () => {
  assert.equal(
    violation("packages/contracts/src/orders.ts", "export type GroceryOrderRow = { id: string }; ")
      .code,
    "CONTRACT_EXPORTS_ROW",
  );
});

test("reports stable line numbers and accepts legal imports", () => {
  assert.equal(
    violation(
      "apps/web/lib/bad.ts",
      [
        'import type { RpcResult } from "@freshmarkets/contracts";',
        'export { x } from "../../core/src/x";',
      ].join("\n"),
    ).line,
    2,
  );

  assert.deepEqual(
    analyzeSourceFile(
      "apps/core/src/orders/domain/order.ts",
      [
        'import type { OrderState } from "@freshmarkets/contracts";',
        'import type { OrderRepository } from "./order-repository";',
      ].join("\n"),
    ),
    [],
  );
});
