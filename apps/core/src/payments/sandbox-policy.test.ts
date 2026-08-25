import { describe, expect, it } from "vitest";
import { isSandboxPaymentEnabled } from "./sandbox-policy";

describe("isSandboxPaymentEnabled", () => {
  it("rejects every production-like environment regardless of payment mode", () => {
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "production", PAYMENT_MODE: "sandbox" })).toBe(
      false,
    );
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "preview", PAYMENT_MODE: "sandbox" })).toBe(
      false,
    );
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "production" })).toBe(false);
    expect(isSandboxPaymentEnabled({ PAYMENT_MODE: "sandbox", ENVIRONMENT: "staging" })).toBe(
      false,
    );
  });

  it("requires the explicit sandbox payment mode", () => {
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "disabled" })).toBe(
      false,
    );
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development" })).toBe(false);
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "live" })).toBe(
      false,
    );
  });

  it("permits only explicit nonproduction environment plus sandbox mode", () => {
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_MODE: "sandbox" })).toBe(
      true,
    );
    expect(isSandboxPaymentEnabled({ ENVIRONMENT: "test", PAYMENT_MODE: "sandbox" })).toBe(true);
  });

  it("does not treat an unset environment as production", () => {
    expect(isSandboxPaymentEnabled({ PAYMENT_MODE: "sandbox" })).toBe(true);
  });
});
