import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createCoreRpcContext } from "./context";
import { createOrdersRpc } from "./orders-rpc";

describe("Orders RPC adapter", () => {
  it("validates page bounds and preserves authentication", async () => {
    const rpc = createOrdersRpc(createCoreRpcContext(env));
    for (const limit of [0, 101, 0.5])
      expect(
        await rpc.listCustomerOrders({ requestId: "history", headers: {}, limit }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await rpc.listCustomerOrders({ requestId: "history", headers: {}, limit: 25 }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(
      await rpc.getCheckoutPaymentCompletion({
        requestId: "completion-invalid",
        headers: {},
        paymentIntentId: "",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await rpc.getCheckoutPaymentCompletion({
        requestId: "completion-auth",
        headers: {},
        paymentIntentId: "payment-1",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });
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
    const summary = await rpc.getProvisionalTransactionSummary({
      requestId: "orders-summary-adapter",
      headers: {},
      orderId: "order-1",
    });
    expect(summary).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "orders-summary-adapter" },
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
  it("rejects new paid-order additions at the reachable customer boundary", async () => {
    const context = createCoreRpcContext(env);
    vi.spyOn(context.access, "resolveAuthenticatedCustomer").mockResolvedValue({
      ok: true,
      requestId: "addition-closed",
      value: {
        customerId: "customer-1",
        principalId: "principal-1",
        customerStatus: "active",
        user: { id: "user-1", email: "test@example.com", name: "Test", emailVerified: true },
      },
    });
    const rpc = createOrdersRpc(context);
    expect(
      await rpc.listOrderAdditionOptions({
        requestId: "addition-closed",
        headers: {},
        orderId: "order-1",
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(
      await rpc.createOrderAmendment({
        requestId: "addition-closed",
        headers: {},
        orderId: "order-1",
        expectedOrderVersion: 1,
        additions: [{ skuId: "sku-1", quantity: 1 }],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  });
});
