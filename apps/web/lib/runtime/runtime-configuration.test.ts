import { describe, expect, it } from "vitest";
import { parseWebRuntimeConfiguration } from "./runtime-configuration";

describe("parseWebRuntimeConfiguration", () => {
  it.each(["development", "test"] as const)("allows loopback HTTP in %s", (environment) => {
    expect(
      parseWebRuntimeConfiguration({
        ENVIRONMENT: environment,
        PUBLIC_APP_ORIGIN: "http://localhost:3000",
      }),
    ).toEqual({ environment, publicAppOrigin: "http://localhost:3000", secureCookies: false });
  });

  it.each(["preview", "staging", "production"] as const)(
    "requires HTTPS and a non-loopback public origin in %s",
    (environment) => {
      expect(() =>
        parseWebRuntimeConfiguration({
          ENVIRONMENT: environment,
          PUBLIC_APP_ORIGIN: "http://localhost:3000",
        }),
      ).toThrow("PUBLIC_APP_ORIGIN_INSECURE");
      expect(
        parseWebRuntimeConfiguration({
          ENVIRONMENT: environment,
          PUBLIC_APP_ORIGIN: "https://freshmarkets.ph",
        }),
      ).toEqual({ environment, publicAppOrigin: "https://freshmarkets.ph", secureCookies: true });
    },
  );

  it("rejects missing, malformed, path-bearing, and unknown-environment values", () => {
    expect(() =>
      parseWebRuntimeConfiguration({ ENVIRONMENT: "development" }),
    ).toThrow("PUBLIC_APP_ORIGIN_REQUIRED");
    expect(() =>
      parseWebRuntimeConfiguration({
        ENVIRONMENT: "development",
        PUBLIC_APP_ORIGIN: "not-a-url",
      }),
    ).toThrow("PUBLIC_APP_ORIGIN_INVALID");
    expect(() =>
      parseWebRuntimeConfiguration({
        ENVIRONMENT: "development",
        PUBLIC_APP_ORIGIN: "https://freshmarkets.ph/app",
      }),
    ).toThrow("PUBLIC_APP_ORIGIN_INVALID");
    expect(() =>
      parseWebRuntimeConfiguration({
        ENVIRONMENT: "prod",
        PUBLIC_APP_ORIGIN: "https://freshmarkets.ph",
      }),
    ).toThrow("ENVIRONMENT_INVALID");
  });
});
