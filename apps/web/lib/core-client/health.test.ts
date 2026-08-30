import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type HealthService } from "@freshmarkets/contracts";
import { getCoreHealth } from "./health";

describe("Web Core client", () => {
  it("delegates health through the typed Core binding", async () => {
    const health = vi.fn(async () => ({
      service: "core" as const,
      status: "ok" as const,
      contractVersion: CONTRACT_VERSION,
      environment: "test",
      databaseBindingConfigured: true,
      timestamp: new Date(0).toISOString(),
    }));
    const core: HealthService = { health };

    const response = await getCoreHealth(core, "web-test-request");

    expect(health).toHaveBeenCalledWith({ requestId: "web-test-request" });
    expect(response.status).toBe("ok");
  });
});
