import { describe, expect, it } from "vitest";
import {
  buildDeliveryProvider,
  buildDeliveryProviderRegistry,
  configuredInstantDeliveryPartners,
} from "./runtime-delivery-provider";

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
    ).toThrow("DELIVERY_PROVIDERS_INVALID");
    expect(() =>
      buildDeliveryProvider({ ENVIRONMENT: "test", DELIVERY_PROVIDER: "grab-express" }),
    ).toThrow("GRAB_EXPRESS_NOT_VERIFIED_FOR_CEBU");
    expect(() =>
      buildDeliveryProvider({
        ENVIRONMENT: "test",
        DELIVERY_PROVIDER: "grab-express",
        GRAB_EXPRESS_SERVICE_TYPE: "INSTANT",
        GRAB_EXPRESS_CLIENT_ID: "client",
      }),
    ).toThrow("GRAB_EXPRESS_NOT_VERIFIED_FOR_CEBU");
  });

  it("constructs only the verified Cebu adapter", () => {
    expect(
      buildDeliveryProvider({
        ENVIRONMENT: "staging",
        DELIVERY_PROVIDER: "lalamove",
        LALAMOVE_API_KEY: "key",
        LALAMOVE_API_SECRET: "secret",
        LALAMOVE_MARKET: "PH",
        LALAMOVE_LANGUAGE: "en_PH",
        LALAMOVE_SERVICE_TYPE: "MOTORCYCLE",
      })?.code,
    ).toBe("lalamove");
  });

  it("builds the public-safe checkout catalog from verified providers only", () => {
    const environment = {
      ENVIRONMENT: "test",
      DELIVERY_PROVIDERS: "lalamove",
      LALAMOVE_API_KEY: "key",
      LALAMOVE_API_SECRET: "secret",
      LALAMOVE_MARKET: "PH",
      LALAMOVE_LANGUAGE: "en_PH",
      LALAMOVE_SERVICE_TYPE: "MOTORCYCLE",
      GRAB_EXPRESS_CLIENT_ID: "client",
      GRAB_EXPRESS_CLIENT_SECRET: "secret",
      GRAB_EXPRESS_SERVICE_TYPE: "INSTANT",
    };

    expect([...buildDeliveryProviderRegistry(environment).keys()]).toEqual(["lalamove"]);
    expect(configuredInstantDeliveryPartners(environment)).toEqual([
      {
        providerCode: "lalamove",
        displayName: "Lalamove",
        serviceType: "MOTORCYCLE",
        serviceLabel: "Motorcycle",
      },
    ]);
  });
});
