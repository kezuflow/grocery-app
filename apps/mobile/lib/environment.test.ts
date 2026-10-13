import { describe, expect, it, vi } from "vitest";
import config from "../app.config";
import { parseEnvironment } from "./environment";

describe("isolated mobile configuration", () => {
  it("shares the canonical origin used by the app and readiness marks", async () => {
    vi.resetModules();
    vi.stubEnv("EXPO_PUBLIC_APP_VARIANT", "development");
    vi.stubEnv("EXPO_PUBLIC_BACKEND_ORIGIN", "http://10.0.2.2:3100/");
    try {
      const { mobileEnvironment } = await import("./runtime-environment");
      expect(mobileEnvironment.backendOrigin).toBe("http://10.0.2.2:3100");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("separates native identities and callback schemes", () => {
    const development = parseEnvironment({
      variant: "development",
      backendOrigin: "http://10.0.2.2:3187",
    });
    const beta = parseEnvironment({
      variant: "private-beta",
      backendOrigin: "https://isolated.example.test",
    });
    expect(development.applicationId).toBe("ph.freshmarkets.customer.development");
    expect(beta.applicationId).toBe("ph.freshmarkets.customer.beta");
    expect(development.scheme).toBe("freshmarkets-development");
    expect(beta.scheme).toBe("freshmarkets-beta");
  });
  it("rejects missing configuration and unsafe backend destinations", () => {
    for (const input of [
      {},
      { variant: "production", backendOrigin: "http://localhost:3187" },
      { variant: "development", backendOrigin: "https://isolated.example.test" },
      { variant: "private-beta", backendOrigin: "http://isolated.example.test" },
      { variant: "private-beta", backendOrigin: "https://localhost" },
      ...[
        "https://freshmarkets.ph",
        "https://freshmarkets.ph.",
        "https://www.freshmarkets.ph",
        "https://freshmarkets-web-production.ilyreggie.workers.dev",
        "https://freshmarkets-web-production.ilyreggie.workers.dev.",
        "https://user:password@isolated.example.test",
        "https://isolated.example.test/api",
        "https://isolated.example.test/?key=value",
        "https://isolated.example.test/#token",
      ].map((backendOrigin) => ({ variant: "private-beta", backendOrigin })),
    ])
      expect(() => parseEnvironment(input)).toThrow();
  });
  it("includes only parsed public settings in the native config", () => {
    const before = { ...process.env };
    try {
      process.env.EXPO_PUBLIC_APP_VARIANT = "development";
      process.env.EXPO_PUBLIC_BACKEND_ORIGIN = "http://localhost:3187";
      process.env.PAYMENT_PROVIDER_SECRET = "synthetic-secret-never-bundle";
      const result = config();
      expect(result.extra).toEqual({
        mobile: {
          variant: "development",
          backendOrigin: "http://localhost:3187",
          applicationId: "ph.freshmarkets.customer.development",
          scheme: "freshmarkets-development",
        },
      });
      expect(JSON.stringify(result)).not.toContain("synthetic-secret-never-bundle");
    } finally {
      process.env = before;
    }
  });
});
