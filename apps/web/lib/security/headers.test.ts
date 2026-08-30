import { describe, expect, it } from "vitest";
import {
  createScriptNonce,
  webContentSecurityPolicy,
  webSecurityHeaders,
  webStaticSecurityHeaders,
} from "./headers";

function headerValue(
  environment: Parameters<typeof webSecurityHeaders>[0],
  key: string,
  scriptNonce?: string,
) {
  return webSecurityHeaders(environment, scriptNonce ?? "test-nonce").find(
    (header) => header.key === key,
  )?.value;
}

describe("Web security headers", () => {
  it("locks the production policy and preserves the required Mapbox sources", () => {
    const policy = headerValue("production", "Content-Security-Policy", "request-nonce");

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-request-nonce'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("connect-src 'self' https://api.mapbox.com https://events.mapbox.com");
  });

  it.each(["development", "test", "preview", "staging", "production"] as const)(
    "requires a request nonce for the %s policy",
    (environment) => {
      expect(() => webContentSecurityPolicy(environment)).toThrow("SCRIPT_NONCE_REQUIRED");
    },
  );

  it("keeps request-varying CSP out of static next.config headers", () => {
    expect(webStaticSecurityHeaders("production")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "Content-Security-Policy" })]),
    );
  });

  it("creates a CSP-safe nonce from a cryptographically random UUID", () => {
    expect(createScriptNonce(() => "123e4567-e89b-12d3-a456-426614174000")).toBe(
      "123e4567e89b12d3a456426614174000",
    );
  });

  it.each(["preview", "staging", "production"] as const)(
    "enables HSTS for the deployed %s environment",
    (environment) => {
      expect(headerValue(environment, "Strict-Transport-Security")).toBe(
        "max-age=63072000; includeSubDomains; preload",
      );
    },
  );

  it.each(["development", "test"] as const)(
    "does not enable HSTS for the local %s environment",
    (environment) => {
      expect(headerValue(environment, "Strict-Transport-Security")).toBeUndefined();
      expect(headerValue(environment, "Content-Security-Policy")).toContain(
        "script-src 'self' 'nonce-test-nonce'",
      );
    },
  );

  it("sets the remaining browser hardening policy", () => {
    expect(webSecurityHeaders("production", "request-nonce")).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(self), payment=(self)",
        },
      ]),
    );
  });
});
