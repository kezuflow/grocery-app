import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("Worker-local readiness smoke", () => {
  it("returns structured health JSON with the caller request reference", async () => {
    const requestId = "53eb71a9-03a7-475b-a30d-7fbfb83ddc79";
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
    const requestId = "ec9bb7de-cdd1-4ee8-bf0a-15c3dd4b1a30";
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
