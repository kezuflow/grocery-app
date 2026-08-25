import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type CoreHealthResponse } from "./index";

describe("phase 0 contracts", () => {
  it("publishes a stable contract version", () => {
    expect(CONTRACT_VERSION).toBe("2026-08-25.mvp-commerce");
  });

  it("keeps the health DTO purpose-built", () => {
    const response: CoreHealthResponse = {
      service: "core",
      status: "ok",
      contractVersion: CONTRACT_VERSION,
      environment: "test",
      databaseBindingConfigured: false,
      timestamp: new Date(0).toISOString(),
    };

    expect(response).not.toHaveProperty("databaseRow");
  });
});
