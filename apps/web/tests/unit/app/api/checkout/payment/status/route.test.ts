import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCheckoutPaymentCompletion } = vi.hoisted(() => ({
  getCheckoutPaymentCompletion: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { CORE: { getCheckoutPaymentCompletion } } }));

import { GET } from "@/app/api/checkout/payment/status/route";

beforeEach(() => getCheckoutPaymentCompletion.mockReset());

describe("checkout payment completion route", () => {
  it("forwards the authenticated request context and disables caching", async () => {
    getCheckoutPaymentCompletion.mockResolvedValue({
      ok: true,
      value: { paymentIntentId: "payment-1", state: "COMPLETED", orderId: "order-1" },
      requestId: "123e4567-e89b-42d3-a456-426614174000",
    });
    const response = await GET(
      new Request("https://freshmarkets.ph/api/checkout/payment/status?paymentIntentId=payment-1", {
        headers: {
          cookie: "session=customer",
          "x-request-id": "123e4567-e89b-42d3-a456-426614174000",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getCheckoutPaymentCompletion).toHaveBeenCalledWith({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      headers: {
        cookie: "session=customer",
        "x-request-id": "123e4567-e89b-42d3-a456-426614174000",
      },
      paymentIntentId: "payment-1",
    });
  });

  it("rejects a missing payment id before Core", async () => {
    const response = await GET(new Request("https://freshmarkets.ph/api/checkout/payment/status"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getCheckoutPaymentCompletion).not.toHaveBeenCalled();
  });
});
