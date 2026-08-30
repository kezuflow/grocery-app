import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCheckoutRpc } from "./checkout-rpc";
import { createCoreRpcContext } from "./context";

describe("Checkout RPC adapter", () => {
  it("rejects invalid commands before resolving a customer", async () => {
    const rpc = createCheckoutRpc(createCoreRpcContext(env));
    const result = await rpc.setCartItem({
      requestId: "checkout-adapter",
      headers: {},
      idempotencyKey: "valid-adapter-key",
      cartId: "cart-1",
      skuId: "",
      quantity: -1,
      expectedVersion: -1,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", requestId: "checkout-adapter" },
    });
    const abandon = await rpc.abandonCheckoutAttempt({
      requestId: "checkout-abandon-adapter",
      headers: {},
      quoteId: "quote-1",
      expectedVersion: 1,
      idempotencyKey: "checkout-abandon-key",
    });
    expect(abandon).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "checkout-abandon-adapter" },
    });
  });
});
