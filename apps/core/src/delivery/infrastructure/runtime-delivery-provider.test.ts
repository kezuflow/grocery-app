import { describe, expect, it } from "vitest";
import { buildDeliveryProvider } from "./runtime-delivery-provider";

describe("runtime delivery provider", () => {
  it("is disabled unless explicitly selected", () => {
    expect(buildDeliveryProvider({ ENVIRONMENT: "test" })).toBeNull();
    expect(
      buildDeliveryProvider({ ENVIRONMENT: "production", DELIVERY_PROVIDER: "disabled" }),
    ).toBeNull();
  });

  it("fails closed for unknown or incomplete provider configuration", () => {
    expect(() =>
      buildDeliveryProvider({ ENVIRONMENT: "test", DELIVERY_PROVIDER: "other" }),
    ).toThrow("DELIVERY_PROVIDER_INVALID");
    expect(() =>
      buildDeliveryProvider({ ENVIRONMENT: "test", DELIVERY_PROVIDER: "grab-express" }),
    ).toThrow("GRAB_EXPRESS_CLIENT_ID_REQUIRED");
    expect(() =>
      buildDeliveryProvider({
        ENVIRONMENT: "test",
        DELIVERY_PROVIDER: "grab-express",
        GRAB_EXPRESS_CLIENT_ID: "client",
      }),
    ).toThrow("GRAB_EXPRESS_CLIENT_SECRET_REQUIRED");
  });

  it("constructs only the approved adapter", () => {
    expect(
      buildDeliveryProvider({
        ENVIRONMENT: "staging",
        DELIVERY_PROVIDER: "grab-express",
        GRAB_EXPRESS_CLIENT_ID: "client",
        GRAB_EXPRESS_CLIENT_SECRET: "secret",
      })?.code,
    ).toBe("grab-express");
  });
});
