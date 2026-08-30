import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createCoreRpcContext } from "./context";
import type { CoreRpcContext } from "./context";
import { createPaymentsRpc } from "./payments-rpc";

describe("Payments RPC adapter", () => {
  it("hides the simulator before authentication outside local environments", async () => {
    const resolveAuthenticatedCustomer = vi.fn();
    const context = {
      runtimeConfiguration: () => ({ environment: "production" }),
      access: { resolveAuthenticatedCustomer },
    } as unknown as CoreRpcContext;
    const rpc = createPaymentsRpc(context);
    const result = await rpc.simulateMockProviderEvent({
      requestId: "production-simulator",
      headers: {},
      providerReference: "mock_pay_hidden",
      outcome: "SUCCEEDED",
      idempotencyKey: "hidden-simulator-key",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(resolveAuthenticatedCustomer).not.toHaveBeenCalled();
  });

  it("fails closed for a provider different from runtime selection", async () => {
    const rpc = createPaymentsRpc(createCoreRpcContext(env));
    const result = await rpc.createPaymentIntent({
      requestId: "payments-adapter",
      headers: {},
      checkoutAttemptId: "quote-1",
      expectedQuoteVersion: 1,
      expectedPriceAcceptanceVersion: 1,
      expectedCurrency: "PHP",
      expectedMerchandiseSubtotalMinor: 100,
      expectedItemDiscountMinor: 0,
      expectedOrderDiscountMinor: 0,
      expectedDeliverySubtotalMinor: 0,
      expectedDeliveryFeeMinor: 0,
      expectedDeliveryDiscountMinor: 0,
      expectedServiceFeeMinor: 0,
      expectedTaxMinor: 0,
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
