import { describe, expect, it } from "vitest";
import { parseTrustedOrigins, trustedOriginsForEnvironment } from "./origins";

describe("parseTrustedOrigins", () => {
  it("parses and normalizes a comma-separated allowlist", () => {
    expect(parseTrustedOrigins("https://freshmarkets.ph, https://admin.freshmarkets.ph")).toEqual([
      "https://freshmarkets.ph",
      "https://admin.freshmarkets.ph",
    ]);
  });

  it("removes duplicates after normalization", () => {
    expect(parseTrustedOrigins("https://FreshMarkets.ph, https://freshmarkets.ph:443")).toEqual([
      "https://freshmarkets.ph",
    ]);
  });

  it("rejects non-http schemes", () => {
    expect(() => parseTrustedOrigins("javascript:alert(1)")).toThrow("INVALID_TRUSTED_ORIGIN");
    expect(() => parseTrustedOrigins("ftp://freshmarkets.ph")).toThrow("INVALID_TRUSTED_ORIGIN");
  });

  it("allows http only for explicit loopback hosts", () => {
    expect(parseTrustedOrigins("http://127.0.0.1:8787")).toEqual(["http://127.0.0.1:8787"]);
    expect(parseTrustedOrigins("http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(() => parseTrustedOrigins("http://freshmarkets.ph")).toThrow("INVALID_TRUSTED_ORIGIN");
  });

  it("rejects credentials, paths, queries, and fragments", () => {
    expect(() => parseTrustedOrigins("https://user:pass@freshmarkets.ph")).toThrow(
      "INVALID_TRUSTED_ORIGIN",
    );
    expect(() => parseTrustedOrigins("https://freshmarkets.ph/app")).toThrow(
      "INVALID_TRUSTED_ORIGIN",
    );
    expect(() => parseTrustedOrigins("https://freshmarkets.ph?x=1")).toThrow(
      "INVALID_TRUSTED_ORIGIN",
    );
    expect(() => parseTrustedOrigins("https://freshmarkets.ph#frag")).toThrow(
      "INVALID_TRUSTED_ORIGIN",
    );
  });

  it("returns an empty list for undefined or blank input", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins("   ")).toEqual([]);
  });
});

describe("trustedOriginsForEnvironment", () => {
  it("returns the configured origins in production without implicit additions", () => {
    expect(
      trustedOriginsForEnvironment({
        ENVIRONMENT: "production",
        BETTER_AUTH_URL: "https://freshmarkets.ph",
        TRUSTED_ORIGINS: "https://freshmarkets.ph",
      }),
    ).toEqual(["https://freshmarkets.ph"]);
  });

  it("unions the auth base origin with the configured allowlist", () => {
    expect(
      trustedOriginsForEnvironment({
        ENVIRONMENT: "production",
        BETTER_AUTH_URL: "https://api.freshmarkets.ph",
        TRUSTED_ORIGINS: "https://freshmarkets.ph, https://admin.freshmarkets.ph",
      }),
    ).toEqual([
      "https://api.freshmarkets.ph",
      "https://freshmarkets.ph",
      "https://admin.freshmarkets.ph",
    ]);
  });

  it("requires BETTER_AUTH_URL in production", () => {
    expect(() =>
      trustedOriginsForEnvironment({ ENVIRONMENT: "production", BETTER_AUTH_URL: undefined }),
    ).toThrow("BETTER_AUTH_URL_REQUIRED");
  });

  it("validates configured origins even outside production", () => {
    expect(() =>
      trustedOriginsForEnvironment({
        ENVIRONMENT: "development",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: "javascript:alert(1)",
      }),
    ).toThrow("INVALID_TRUSTED_ORIGIN");
  });

  it("falls back to explicit loopback origins only outside production", () => {
    expect(
      trustedOriginsForEnvironment({ ENVIRONMENT: "development", BETTER_AUTH_URL: undefined }),
    ).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("cannot be expanded by request-controlled values", () => {
    const requestControlled = {
      origin: "https://attacker.example",
      headers: { origin: "https://attacker.example" },
    } as unknown as Record<string, never>;
    const origins = trustedOriginsForEnvironment({
      ENVIRONMENT: "production",
      BETTER_AUTH_URL: "https://freshmarkets.ph",
      TRUSTED_ORIGINS: "https://freshmarkets.ph",
      ...requestControlled,
    });
    expect(origins).toEqual(["https://freshmarkets.ph"]);
    expect(origins).not.toContain("https://attacker.example");
  });
});
