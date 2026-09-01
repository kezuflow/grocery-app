import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelCustomerOrder } = vi.hoisted(() => ({ cancelCustomerOrder: vi.fn() }));
const requireIdempotencyKey = vi.fn();
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ cancelCustomerOrder }),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { POST } from "@/app/api/commerce/orders/[order-id]/cancel/route";

beforeEach(() => {
  cancelCustomerOrder.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("customer cancellation route", () => {
  it("forwards only the expected Order version, reason, and stable command key", async () => {
    requireIdempotencyKey.mockReturnValue("cancel-key");
    cancelCustomerOrder.mockResolvedValue({
      ok: true,
      value: { cancellationId: "cancellation-1", status: "REFUNDS_PROCESSING" },
    });
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1/cancel", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "cancel-key" },
        body: JSON.stringify({ expectedVersion: 4, reason: "Plans changed" }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(cancelCustomerOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        expectedVersion: 4,
        reason: "Plans changed",
        idempotencyKey: "cancel-key",
      }),
    );
    expect(cancelCustomerOrder.mock.calls[0][0]).not.toHaveProperty("actor");
    expect(cancelCustomerOrder.mock.calls[0][0]).not.toHaveProperty("cause");
  });

  it("rejects a blank reason before calling Core", async () => {
    requireIdempotencyKey.mockReturnValue("cancel-key");
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 4, reason: "  " }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(400);
    expect(cancelCustomerOrder).not.toHaveBeenCalled();
  });
});
