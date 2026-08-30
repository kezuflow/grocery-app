import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createOperationsRpc } from "./operations-rpc";

describe("Operations RPC adapter", () => {
  it("rejects invalid inventory input before authorization", async () => {
    const rpc = createOperationsRpc(createCoreRpcContext(env));
    const result = await rpc.adjustInventory({
      requestId: "operations-adapter",
      headers: {},
      locationId: "",
      inventoryPoolId: "",
      delta: 0,
      reason: "",
      expectedVersion: -1,
      idempotencyKey: "operations-adapter-key",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", requestId: "operations-adapter" },
    });
  });
});
