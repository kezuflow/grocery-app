import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

describe("Core security boundary", () => {
  it("rejects unauthenticated admin requests before returning data", async () => {
    const result = await core.getAdminContext({
      requestId: "security-unauthenticated",
      headers: { "x-request-id": "security-unauthenticated" },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("rejects malformed Core input with the stable validation envelope", async () => {
    const result = await core.getAdminContext({
      headers: {},
      // Deliberately missing requestId is rejected by the boundary schema.
    } as never);
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("does not expose the D1 binding or provider internals through health", async () => {
    const result = await core.health({ requestId: "security-health" });
    expect(result).toMatchObject({ service: "core", status: "ok" });
    expect(result).not.toHaveProperty("DB");
    expect(result).not.toHaveProperty("provider");
    expect(JSON.stringify(result)).not.toContain("D1Database");
  });
});
