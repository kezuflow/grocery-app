import { describe, expect, it } from "vitest";
import type { CartView, SetCartItemRequest } from "./index";

describe("cart contracts", () => {
  it("requires aggregate identity, expected version, and idempotency", () => {
    const command = {
      requestId: "request-1",
      headers: {},
      cartId: "cart-1",
      skuId: "sku-1",
      quantity: 2,
      expectedVersion: 3,
      idempotencyKey: "cart-key-12345678",
    } satisfies SetCartItemRequest;
    expect(command.expectedVersion).toBe(3);
  });

  it("represents missing price explicitly rather than as zero", () => {
    const cart: CartView = {
      id: "cart-1",
      version: 1,
      items: [
        {
          skuId: "sku-1",
          quantity: 1,
          name: "Item",
          availability: "PRICE_UNAVAILABLE",
          unitPriceMinor: null,
          lineTotalMinor: null,
        },
      ],
      totalMinor: 0,
      currency: "PHP",
      checkoutBlocked: true,
      blockingReasons: ["PRICE_UNAVAILABLE"],
    };
    expect(cart.items[0]?.unitPriceMinor).toBeNull();
  });
});
