import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { CONTRACT_VERSION } from "@freshmarkets/contracts";
import { buildHealthResponse } from "./index";

describe("Core Worker foundation", () => {
  it("exposes the typed health RPC", async () => {
    const response = buildHealthResponse({
      DB: {} as D1Database,
      PRODUCT_MEDIA: {} as R2Bucket,
      ENVIRONMENT: "development",
      BETTER_AUTH_URL: "http://localhost:3000",
      TRUSTED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000,https://core.example.invalid",
      PAYMENT_PROVIDER: "mock",
      MEMBERSHIP_RENEWAL_INITIATION_ENABLED: "false",
      ROUTE_DISTANCE_PROVIDER: "mapbox",
      MAPBOX_ACCESS_TOKEN: "test-placeholder",
      EMAIL: { send: async () => ({ messageId: "test-message" }) },
    });

    expect(response.service).toBe("core");
    expect(response.status).toBe("ok");
    expect(response.contractVersion).toBe(CONTRACT_VERSION);
    expect(response.environment).toBe("development");
  });

  it("returns a structured not-found error from the HTTP surface", async () => {
    const response = await SELF.fetch("https://core.example.invalid/unknown");
    const body = (await response.json()) as { error: { code: string; requestId: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
  });

  it("serves the HTTP health smoke endpoint", async () => {
    const response = await SELF.fetch("https://core.example.invalid/health");
    const body = (await response.json()) as { service: string; status: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ service: "core", status: "ok" });
  });
});
