import { describe, expect, it } from "vitest";
import { webSecurityHeaders } from "./headers";

function headerValue(environment: Parameters<typeof webSecurityHeaders>[0], key: string) {
  return webSecurityHeaders(environment).find((header) => header.key === key)?.value;
}

describe("Web security headers", () => {
  it("locks the production policy and preserves the required Mapbox sources", () => {
    const policy = headerValue("production", "Content-Security-Policy");

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("connect-src 'self' https://api.mapbox.com https://events.mapbox.com");
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
    },
  );

  it("sets the remaining browser hardening policy", () => {
    expect(webSecurityHeaders("production")).toEqual(
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
