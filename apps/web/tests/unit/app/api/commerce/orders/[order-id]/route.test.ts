import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCustomerOrderDetail } = vi.hoisted(() => ({ getCustomerOrderDetail: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ getCustomerOrderDetail }),
}));

import { GET } from "@/app/api/commerce/orders/[order-id]/route";

beforeEach(() => getCustomerOrderDetail.mockReset());

describe("customer order detail route", () => {
  it("forwards only the route identity and request context to Core", async () => {
    getCustomerOrderDetail.mockResolvedValue({ ok: true, value: { orderId: "order-1" } });
    const response = await GET(
      new Request("https://freshmarkets.ph/api/commerce/orders/order-1", {
        headers: { cookie: "session=one" },
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(getCustomerOrderDetail).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", headers: expect.any(Object) }),
    );
    expect(getCustomerOrderDetail.mock.calls[0][0]).not.toHaveProperty("customerId");
  });

  it("preserves Core's ownership-safe not-found result", async () => {
    getCustomerOrderDetail.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: "r" },
    });
    const response = await GET(new Request("https://freshmarkets.ph/api/commerce/orders/other"), {
      params: Promise.resolve({ "order-id": "other" }),
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
