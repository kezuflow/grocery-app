import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker-local readiness smoke", () => {
  it("returns structured health JSON with the caller request reference", async () => {
    const requestId = "worker-smoke-health";
    const response = await SELF.fetch("https://core.example.invalid/health", {
      headers: { "x-request-id": requestId },
    });
    const body = (await response.json()) as {
      service?: string;
      status?: string;
      contractVersion?: string;
      databaseBindingConfigured?: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(body).toMatchObject({
      service: "core",
      status: "ok",
      databaseBindingConfigured: true,
    });
    expect(typeof body.contractVersion).toBe("string");
  });

  it("returns dependency readiness separately from liveness", async () => {
    const requestId = "worker-smoke-readiness";
    const response = await SELF.fetch("https://core.example.invalid/ready", {
      headers: { "x-request-id": requestId },
    });
    const body = (await response.json()) as {
      status?: string;
      checks?: { database?: string; paymentProvider?: { status?: string } };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(body).toMatchObject({
      status: "ready",
      checks: { database: "ready", paymentProvider: { status: "ready" } },
    });
  });
});
