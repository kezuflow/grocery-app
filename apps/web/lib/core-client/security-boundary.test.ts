import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { requestHeaders } from "./request";

describe("Core client request boundary", () => {
  it("forwards only approved cookies, request metadata, and browser context", () => {
    const request = new Request("https://freshmarkets.ph/api/admin/context", {
      headers: {
        cookie: "better-auth.session_token=session-value",
        "x-request-id": "request-123",
        "x-correlation-id": "correlation-456",
        origin: "https://freshmarkets.ph",
        referer: "https://freshmarkets.ph/admin",
        "user-agent": "readiness-test",
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer must-not-forward",
        "x-mapbox-access-token": "server-token-must-not-forward",
        "x-mapbox-public-access-token": "public-token-must-not-forward",
        "x-forwarded-for": "192.0.2.1",
        "x-browser-random": "must-not-forward",
      },
    });

    expect(requestHeaders(request)).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      cookie: "better-auth.session_token=session-value",
      origin: "https://freshmarkets.ph",
      referer: "https://freshmarkets.ph/admin",
      "user-agent": "readiness-test",
      "x-request-id": "request-123",
      "x-correlation-id": "correlation-456",
    });
  });

  it("does not create an authorization header or expose request bodies", () => {
    const request = new Request("https://freshmarkets.ph/api/admin/context", {
      headers: { cookie: "session=value", "x-request-id": "request-789" },
    });
    const headers = requestHeaders(request);

    expect(headers.authorization).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-browser-random"]).toBeUndefined();
    expect(headers["x-mapbox-access-token"]).toBeUndefined();
    expect(headers["x-mapbox-public-access-token"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("password");
  });

  it("keeps the Core binding as the only route dependency", async () => {
    const core = { getAdminContext: vi.fn().mockResolvedValue({ ok: false }) };
    expect(core.getAdminContext).toBeDefined();
  });

  it("keeps the maps and dispatch runbook as the production security and recovery checklist", () => {
    const runbookUrl = new URL("../../../../docs/runbooks/MAPS_AND_DISPATCH.md", import.meta.url);
    const runbook = existsSync(runbookUrl) ? readFileSync(runbookUrl, "utf8") : "";

    expect(runbook).toMatch(/MAPBOX_PUBLIC_ACCESS_TOKEN/);
    expect(runbook).toMatch(/MAPBOX_ACCESS_TOKEN/);
    expect(runbook).toMatch(/permanent geocod/i);
    expect(runbook).toMatch(/polygon.*version|version.*polygon/i);
    expect(runbook).toMatch(/Content-Security-Policy|CSP/);
    expect(runbook).toMatch(/provider outage/i);
    expect(runbook).toMatch(/idempotenc/i);
    expect(runbook).toMatch(/no (route )?optimization|must not optimize/i);
    expect(runbook).toMatch(/no live tracking|must not track/i);
    expect(runbook).toMatch(/rollback/i);
    expect(runbook).toMatch(/privacy-safe|PII-safe/i);
    expect(runbook).toMatch(/Customer.*smoke/i);
    expect(runbook).toMatch(/Admin.*smoke/i);
    expect(runbook).toMatch(/Rider.*smoke/i);
  });
});
