import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CoreEntrypoint, buildReadinessResponse } from "../index";

describe("Core readiness", () => {
  it("probes critical runtime configuration, D1, and payment readiness", async () => {
    const response = await buildReadinessResponse(env);

    expect(response).toMatchObject({
      service: "core",
      status: "ready",
      checks: {
        runtimeConfiguration: "ready",
        database: "ready",
        paymentProvider: {
          status: "ready",
          code: "mock",
          capabilities: [
            "PAYMENT_CREATE",
            "RECURRING_AUTHORIZATION",
            "WEBHOOK_VERIFICATION",
            "PAYMENT_LOOKUP",
            "REFUND_REQUEST",
          ],
        },
      },
    });
    expect(response).not.toHaveProperty("error");
    expect(JSON.stringify(response)).not.toContain("MAPBOX_ACCESS_TOKEN");
    expect(JSON.stringify(response)).not.toContain("BETTER_AUTH_SECRET");
  });

  it("fails closed without exposing D1 failure details", async () => {
    const response = await buildReadinessResponse({
      ...env,
      DB: {
        prepare: () => ({ first: async () => Promise.reject(new Error("secret database detail")) }),
      } as unknown as D1Database,
    });

    expect(response).toMatchObject({
      status: "not_ready",
      checks: { database: "not_ready" },
    });
    expect(JSON.stringify(response)).not.toContain("secret database detail");
  });

  it("exposes readiness through the typed Worker entrypoint", async () => {
    const core = new CoreEntrypoint({} as ExecutionContext, env);
    const response = await core.readiness({ requestId: "readiness-integration" });

    expect(response.status).toBe("ready");
  });
});
