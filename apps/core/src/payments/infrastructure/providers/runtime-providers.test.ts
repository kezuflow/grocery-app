import { describe, expect, it } from "vitest";
import { buildProviderRegistry, selectedPaymentProviderCode } from "./runtime-providers";

describe("runtime payment provider selection", () => {
  it("registers the deterministic mock only when explicitly selected in development or test", () => {
    for (const environment of ["development", "test"]) {
      const config = { ENVIRONMENT: environment, PAYMENT_PROVIDER: "mock" };
      expect(selectedPaymentProviderCode(config)).toBe("mock");
      expect(buildProviderRegistry(config).require("mock").code).toBe("mock");
    }
  });

  it("fails closed when selection is absent, unknown, or production-like", () => {
    for (const config of [
      { ENVIRONMENT: "development" },
      { ENVIRONMENT: "development", PAYMENT_PROVIDER: "unapproved" },
      { ENVIRONMENT: "production", PAYMENT_PROVIDER: "mock" },
      { ENVIRONMENT: "preview", PAYMENT_PROVIDER: "mock" },
      { PAYMENT_PROVIDER: "mock" },
    ]) {
      expect(selectedPaymentProviderCode(config)).toBeNull();
      expect(() => buildProviderRegistry(config).require("mock")).toThrow(
        /PAYMENT_PROVIDER_UNCONFIGURED/,
      );
    }
  });

  it("has no registration-order fallback", () => {
    const registry = buildProviderRegistry({
      ENVIRONMENT: "test",
      PAYMENT_PROVIDER: "mock",
    });
    expect("firstCode" in registry).toBe(false);
  });
});
