import { describe, expect, it } from "vitest";
import { isMockPaymentEnabled } from "./mock-policy";

describe("isMockPaymentEnabled", () => {
  it("rejects every production-like environment regardless of payment mode", () => {
    expect(isMockPaymentEnabled({ ENVIRONMENT: "production", PAYMENT_PROVIDER: "mock" })).toBe(
      false,
    );
    expect(isMockPaymentEnabled({ ENVIRONMENT: "preview", PAYMENT_PROVIDER: "mock" })).toBe(false);
    expect(isMockPaymentEnabled({ ENVIRONMENT: "production" })).toBe(false);
    expect(isMockPaymentEnabled({ PAYMENT_PROVIDER: "mock", ENVIRONMENT: "staging" })).toBe(false);
  });

  it("requires the explicit mock provider", () => {
    expect(isMockPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_PROVIDER: "disabled" })).toBe(
      false,
    );
    expect(isMockPaymentEnabled({ ENVIRONMENT: "development" })).toBe(false);
    expect(isMockPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_PROVIDER: "live" })).toBe(
      false,
    );
  });

  it("permits only explicit nonproduction environment plus mock selection", () => {
    expect(isMockPaymentEnabled({ ENVIRONMENT: "development", PAYMENT_PROVIDER: "mock" })).toBe(
      true,
    );
    expect(isMockPaymentEnabled({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" })).toBe(true);
  });

  it("fails closed when the environment is absent", () => {
    expect(isMockPaymentEnabled({ PAYMENT_PROVIDER: "mock" })).toBe(false);
  });
});
