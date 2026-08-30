import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createOrdersRpc } from "./orders-rpc";

describe("Orders RPC adapter", () => {
  it("preserves customer authorization failure", async () => {
    const rpc = createOrdersRpc(createCoreRpcContext(env));
    const result = await rpc.listCustomerOrders({ requestId: "orders-adapter", headers: {} });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-adapter" },
    });
    const detail = await rpc.getCustomerOrderDetail({
      requestId: "orders-detail-adapter",
      headers: {},
      orderId: "order-1",
    });
    expect(detail).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-detail-adapter" },
    });
  });
});
