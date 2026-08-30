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
  const acceptedPrice = {
    expectedQuoteVersion: 1,
    expectedPriceAcceptanceVersion: 2,
    expectedCurrency: "PHP",
    expectedMerchandiseSubtotalMinor: 10_000,
    expectedItemDiscountMinor: 100,
    expectedOrderDiscountMinor: 900,
    expectedDeliverySubtotalMinor: 500,
    expectedDeliveryFeeMinor: 0,
    expectedDeliveryDiscountMinor: 500,
    expectedServiceFeeMinor: 0,
    expectedTaxMinor: 0,
    expectedTotalMinor: 9_000,
  };

  it("forwards the accepted quote version and every explicit financial component", async () => {
    requireIdempotencyKey.mockReturnValue("accepted-price-key");
    createPaymentIntent.mockResolvedValue({ ok: true, value: { state: "REQUIRES_ACTION" } });

    const response = await POST(
      new Request("https://freshmarkets.ph/api/checkout/payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkoutAttemptId: "q-accepted",
          ...acceptedPrice,
          returnUrl: "https://freshmarkets.ph/orders",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutAttemptId: "q-accepted", ...acceptedPrice }),
    );
  });

  it("rejects an incomplete or stale-version acceptance before Core", async () => {
    requireIdempotencyKey.mockReturnValue("incomplete-key");
    const response = await POST(
      new Request("https://freshmarkets.ph/api/checkout/payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkoutAttemptId: "q-stale",
          expectedTotalMinor: 9_000,
          returnUrl: "https://freshmarkets.ph/orders",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

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
        body: JSON.stringify({
          checkoutAttemptId: "q1",
          ...acceptedPrice,
          returnUrl: "https://x/orders",
        }),
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
        body: JSON.stringify({
          checkoutAttemptId: "q1",
          ...acceptedPrice,
          returnUrl: "https://x/orders",
        }),
      }),
    );
    const body = (await response.json()) as { value: Record<string, unknown> };
    expect(body.value.state).toBe("REQUIRES_ACTION");
    expect(body.value).not.toHaveProperty("orderId");
  });

  it("returns the same usable continuation for a repeated payment request", async () => {
    requireIdempotencyKey.mockReturnValue("same-key");
    const action = {
      ok: true,
      value: {
        paymentIntentId: "pi-replay",
        state: "REQUIRES_ACTION",
        actionType: "REDIRECT",
        redirectUrl: "https://pay.example/continue",
        clientToken: null,
        expiresAt: null,
      },
      requestId: "r",
    };
    createPaymentIntent.mockResolvedValue(action);
    const request = () =>
      new Request("https://freshmarkets.ph/api/checkout/payment", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "same-key" },
        body: JSON.stringify({
          checkoutAttemptId: "q-replay",
          ...acceptedPrice,
          returnUrl: "https://freshmarkets.ph/orders",
        }),
      });

    const first = await POST(request());
    const replay = await POST(request());

    await expect(first.json()).resolves.toEqual(action);
    await expect(replay.json()).resolves.toEqual(action);
  });
});
