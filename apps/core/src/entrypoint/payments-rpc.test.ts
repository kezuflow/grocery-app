import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createPaymentsRpc } from "./payments-rpc";

describe("Payments RPC adapter", () => {
  it("fails closed for a provider different from runtime selection", async () => {
    const rpc = createPaymentsRpc(createCoreRpcContext(env));
    const result = await rpc.createPaymentIntent({
      requestId: "payments-adapter",
      headers: {},
      checkoutAttemptId: "quote-1",
      expectedTotalMinor: 100,
      providerCode: "not-configured",
      returnUrl: "https://freshmarkets.test/checkout",
      idempotencyKey: "payments-adapter-key",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PAYMENT_PROVIDER_UNAVAILABLE", requestId: "payments-adapter" },
    });
  });
});
