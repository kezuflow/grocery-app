import { beforeEach, describe, expect, it, vi } from "vitest";

const { reorderOrder } = vi.hoisted(() => ({ reorderOrder: vi.fn() }));
const requireIdempotencyKey = vi.fn();
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ reorderOrder }) }));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { POST } from "./route";

beforeEach(() => {
  reorderOrder.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("reorder route", () => {
  it("forwards the expected current Cart version and stable command key", async () => {
    requireIdempotencyKey.mockReturnValue("reorder-key");
    reorderOrder.mockResolvedValue({ ok: true, value: { outcome: "COMPLETE" } });
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1/reorder", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "reorder-key" },
        body: JSON.stringify({ expectedCartVersion: 4 }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(reorderOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        expectedCartVersion: 4,
        idempotencyKey: "reorder-key",
      }),
    );
    expect(reorderOrder.mock.calls[0][0]).not.toHaveProperty("cartId");
  });

  it("rejects missing versions before calling Core", async () => {
    requireIdempotencyKey.mockReturnValue("reorder-key");
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(400);
    expect(reorderOrder).not.toHaveBeenCalled();
  });
});
