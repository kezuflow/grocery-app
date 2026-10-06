import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearCart } = vi.hoisted(() => ({
  clearCart: vi.fn(),
}));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ clearCart }) }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));

import { POST } from "@/app/api/commerce/cart/clear/route";

beforeEach(() => {
  clearCart.mockReset();
  clearCart.mockResolvedValue({
    ok: true,
    value: {
      cartId: "cart-1",
      outcome: "CLEARED",
      clearedLineCount: 2,
      releasedCheckoutAttempts: 1,
      newCartVersion: 4,
    },
  });
});

describe("clear cart route", () => {
  it("forwards one bounded typed command and derives customer identity in Core", async () => {
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/cart/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cartId: "cart-1",
          expectedVersion: 3,
          idempotencyKey: "clear-cart-key",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(clearCart).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: "cart-1",
        expectedVersion: 3,
        idempotencyKey: "clear-cart-key",
        requestId: expect.any(String),
        headers: expect.any(Object),
      }),
    );
    expect(clearCart.mock.calls[0]?.[0]).not.toHaveProperty("customerId");
  });

  it("rejects malformed commands before Core", async () => {
    const response = await POST(
      new Request("https://freshmarkets.ph/api/commerce/cart/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cartId: "cart-1", expectedVersion: -1, idempotencyKey: "short" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(clearCart).not.toHaveBeenCalled();
  });
});
