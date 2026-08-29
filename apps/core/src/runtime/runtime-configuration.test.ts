import { describe, expect, it } from "vitest";
import { parseCoreRuntimeConfiguration, parseRuntimeEnvironment } from "./runtime-configuration";

const strongSecret = "a-runtime-secret-with-at-least-32-characters";

describe("parseRuntimeEnvironment", () => {
  it.each(["development", "test", "preview", "staging", "production"] as const)(
    "accepts %s",
    (environment) => expect(parseRuntimeEnvironment(environment)).toBe(environment),
  );

  it("rejects omitted, empty, and unknown configured values", () => {
    expect(() => parseRuntimeEnvironment(undefined)).toThrow("ENVIRONMENT_REQUIRED");
    expect(() => parseRuntimeEnvironment("")).toThrow("ENVIRONMENT_INVALID");
    expect(() => parseRuntimeEnvironment("prod")).toThrow("ENVIRONMENT_INVALID");
  });

  it("defaults only when a local caller explicitly requests it", () => {
    expect(parseRuntimeEnvironment(undefined, { allowLocalDefault: true })).toBe("development");
  });
});

describe("parseCoreRuntimeConfiguration", () => {
  it("builds deterministic local auth configuration", () => {
    const config = parseCoreRuntimeConfiguration({
      ENVIRONMENT: "test",
      BETTER_AUTH_URL: "http://127.0.0.1:8788",
      PAYMENT_PROVIDER: "mock",
    });

    expect(config.environment).toBe("test");
    expect(config.auth.secureCookies).toBe(false);
    expect(config.auth.secret.length).toBeGreaterThanOrEqual(32);
    expect(config.payments.providerCode).toBe("mock");
    expect(config.readiness).toMatchObject({ auth: true, payments: true });
  });

  it.each(["preview", "staging", "production"] as const)(
    "requires secure non-loopback auth configuration in %s",
    (environment) => {
      expect(() => parseCoreRuntimeConfiguration({ ENVIRONMENT: environment })).toThrow(
        "BETTER_AUTH_SECRET_REQUIRED",
      );
      expect(() =>
        parseCoreRuntimeConfiguration({
          ENVIRONMENT: environment,
          BETTER_AUTH_SECRET: "short",
          BETTER_AUTH_URL: "https://freshmarkets.ph",
        }),
      ).toThrow("BETTER_AUTH_SECRET_WEAK");
      expect(() =>
        parseCoreRuntimeConfiguration({
          ENVIRONMENT: environment,
          BETTER_AUTH_SECRET: strongSecret,
          BETTER_AUTH_URL: "http://localhost:3000",
        }),
      ).toThrow("BETTER_AUTH_URL_INSECURE");

      const config = parseCoreRuntimeConfiguration({
        ENVIRONMENT: environment,
        BETTER_AUTH_SECRET: strongSecret,
        BETTER_AUTH_URL: "https://freshmarkets.ph",
        TRUSTED_ORIGINS: "https://freshmarkets.ph,https://admin.freshmarkets.ph",
      });
      expect(config.auth.secureCookies).toBe(true);
      expect(config.auth.trustedOrigins).toEqual([
        "https://freshmarkets.ph",
        "https://admin.freshmarkets.ph",
      ]);
    },
  );

  it("rejects deployed loopback and HTTP trusted origins", () => {
    expect(() =>
      parseCoreRuntimeConfiguration({
        ENVIRONMENT: "production",
        BETTER_AUTH_SECRET: strongSecret,
        BETTER_AUTH_URL: "https://freshmarkets.ph",
        TRUSTED_ORIGINS: "http://127.0.0.1:3000",
      }),
    ).toThrow("TRUSTED_ORIGIN_INSECURE");
  });

  it("requires Google OAuth client values as a pair", () => {
    expect(() =>
      parseCoreRuntimeConfiguration({
        ENVIRONMENT: "development",
        GOOGLE_CLIENT_ID: "client-id",
      }),
    ).toThrow("GOOGLE_OAUTH_CONFIGURATION_PARTIAL");
  });

  it("blocks the mock provider in deployed environments", () => {
    expect(() =>
      parseCoreRuntimeConfiguration({
        ENVIRONMENT: "production",
        BETTER_AUTH_SECRET: strongSecret,
        BETTER_AUTH_URL: "https://freshmarkets.ph",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow("MOCK_PAYMENT_PROVIDER_FORBIDDEN");
  });

  it("reports optional provider and OAuth readiness without secret values", () => {
    const config = parseCoreRuntimeConfiguration({
      ENVIRONMENT: "production",
      BETTER_AUTH_SECRET: strongSecret,
      BETTER_AUTH_URL: "https://freshmarkets.ph",
    });
    expect(config.readiness).toEqual({ auth: true, googleOauth: false, payments: false });
    expect(JSON.stringify(config.readiness)).not.toContain(strongSecret);
  });

  it("defaults renewal initiation off and requires an explicit configured owner", () => {
    expect(
      parseCoreRuntimeConfiguration({ ENVIRONMENT: "test", PAYMENT_PROVIDER: "mock" }).renewals,
    ).toEqual({ initiationEnabled: false });
    expect(
      parseCoreRuntimeConfiguration({
        ENVIRONMENT: "test",
        PAYMENT_PROVIDER: "mock",
        MEMBERSHIP_RENEWAL_INITIATION_ENABLED: "true",
      }).renewals,
    ).toEqual({ initiationEnabled: true });
    expect(() =>
      parseCoreRuntimeConfiguration({
        ENVIRONMENT: "test",
        MEMBERSHIP_RENEWAL_INITIATION_ENABLED: "true",
      }),
    ).toThrow("MEMBERSHIP_RENEWAL_INITIATION_REQUIRES_PAYMENT_PROVIDER");
  });
});
