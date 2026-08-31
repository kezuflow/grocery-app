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
    const cancellation = await rpc.cancelCustomerOrder({
      requestId: "orders-cancel-adapter",
      headers: {},
      orderId: "order-1",
      expectedVersion: 1,
      reason: "Plans changed",
      idempotencyKey: "orders-cancel-key",
    });
    expect(cancellation).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-cancel-adapter" },
    });
    const reorder = await rpc.reorderOrder({
      requestId: "orders-reorder-adapter",
      headers: {},
      orderId: "order-1",
      expectedCartVersion: 1,
      idempotencyKey: "orders-reorder-key",
    });
    expect(reorder).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-reorder-adapter" },
    });
    const issues = await rpc.listCustomerOrderIssues({
      requestId: "orders-issues-adapter",
      headers: {},
      orderId: "order-1",
    });
    expect(issues).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-issues-adapter" },
    });
    const submitted = await rpc.submitCustomerOrderIssue({
      requestId: "orders-submit-issue-adapter",
      headers: {},
      orderId: "order-1",
      category: "OTHER",
      description: "This is a sufficiently detailed issue report.",
      affectedOrderItemIds: [],
      idempotencyKey: "orders-submit-issue-key",
    });
    expect(submitted).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-submit-issue-adapter" },
    });
  });
});
