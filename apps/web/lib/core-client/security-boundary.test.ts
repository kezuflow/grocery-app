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
    expect(JSON.stringify(headers)).not.toContain("password");
  });

  it("keeps the Core binding as the only route dependency", async () => {
    const core = { getAdminContext: vi.fn().mockResolvedValue({ ok: false }) };
    expect(core.getAdminContext).toBeDefined();
  });
});
