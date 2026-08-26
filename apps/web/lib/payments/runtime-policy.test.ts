import { describe, expect, it } from "vitest";
import { isWebSandboxPaymentEnabled } from "./runtime-policy";

describe("isWebSandboxPaymentEnabled", () => {
  it("matches the core containment matrix", () => {
    expect(isWebSandboxPaymentEnabled({ ENVIRONMENT: "production", PAYMENT_MODE: "sandbox" })).toBe(
      false,
    );
    expect(isWebSandboxPaymentEnabled({ ENVIRONMENT: "preview", PAYMENT_MODE: "sandbox" })).toBe(
      false,
    );
    expect(
      isWebSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "disabled" }),
    ).toBe(false);
    expect(isWebSandboxPaymentEnabled({ ENVIRONMENT: "development" })).toBe(false);
    expect(
      isWebSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "sandbox" }),
    ).toBe(true);
    expect(isWebSandboxPaymentEnabled({ ENVIRONMENT: "test", PAYMENT_MODE: "sandbox" })).toBe(true);
  });
});
