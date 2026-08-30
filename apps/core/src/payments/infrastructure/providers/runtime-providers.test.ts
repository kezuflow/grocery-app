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

  it("fails closed when selection is absent", () => {
    for (const config of [
      { ENVIRONMENT: "development" },
      { ENVIRONMENT: "development", PAYMENT_PROVIDER: "disabled" },
    ]) {
      expect(selectedPaymentProviderCode(config)).toBeNull();
      expect(() => buildProviderRegistry(config).require("mock")).toThrow(
        /PAYMENT_PROVIDER_UNCONFIGURED/,
      );
    }
  });

  it("rejects unknown selections, mock leakage, and an omitted environment", () => {
    expect(() =>
      selectedPaymentProviderCode({ ENVIRONMENT: "development", PAYMENT_PROVIDER: "unapproved" }),
    ).toThrow("PAYMENT_PROVIDER_INVALID");
    expect(() =>
      selectedPaymentProviderCode({ ENVIRONMENT: "production", PAYMENT_PROVIDER: "mock" }),
    ).toThrow("MOCK_PAYMENT_PROVIDER_FORBIDDEN");
    expect(() => selectedPaymentProviderCode({ PAYMENT_PROVIDER: "mock" })).toThrow(
      "ENVIRONMENT_REQUIRED",
    );
  });

  it.each(["preview", "staging", "production"])(
    "never registers the mock provider in %s",
    (environment) => {
      expect(() =>
        buildProviderRegistry({ ENVIRONMENT: environment, PAYMENT_PROVIDER: "mock" }),
      ).toThrow("MOCK_PAYMENT_PROVIDER_FORBIDDEN");
      const disabled = buildProviderRegistry({
        ENVIRONMENT: environment,
        PAYMENT_PROVIDER: "disabled",
      });
      expect(() => disabled.require("mock")).toThrow(/PAYMENT_PROVIDER_UNCONFIGURED/);
    },
  );

  it("has no registration-order fallback", () => {
    const registry = buildProviderRegistry({
      ENVIRONMENT: "test",
      PAYMENT_PROVIDER: "mock",
    });
    expect("firstCode" in registry).toBe(false);
  });
});
