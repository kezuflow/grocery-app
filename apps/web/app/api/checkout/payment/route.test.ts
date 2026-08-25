import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPaymentIntent } = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
}));
const requireIdempotencyKey = vi.fn();

vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ createPaymentIntent }),
}));
vi.mock("@/lib/core-client/request", () => ({
  requestHeaders: () => ({}),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { POST } from "./route";

beforeEach(() => {
  createPaymentIntent.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("checkout payment route", () => {
  it("surfaces provider-unavailable as 503 without implying success", async () => {
    requireIdempotencyKey.mockReturnValue("k1");
    createPaymentIntent.mockResolvedValue({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE", message: "No provider" },
    });
    const response = await POST(
      new Request("https://freshmarkets.ph/api/checkout/payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkoutAttemptId: "q1", returnUrl: "https://x/orders" }),
      }),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
  });

  it("returns the pending action view; never an order id", async () => {
    requireIdempotencyKey.mockReturnValue("k2");
    createPaymentIntent.mockResolvedValue({
      ok: true,
      value: {
        paymentIntentId: "pi1",
        state: "REQUIRES_ACTION",
        actionType: "REDIRECT",
        redirectUrl: "https://pay/x",
        clientToken: null,
        expiresAt: null,
      },
      requestId: "r",
    });
    const response = await POST(
      new Request("https://freshmarkets.ph/api/checkout/payment", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "k2" },
        body: JSON.stringify({ checkoutAttemptId: "q1", returnUrl: "https://x/orders" }),
      }),
    );
    const body = (await response.json()) as { value: Record<string, unknown> };
    expect(body.value.state).toBe("REQUIRES_ACTION");
    expect(body.value).not.toHaveProperty("orderId");
  });
});
