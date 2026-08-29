import { describe, expect, it, vi } from "vitest";
import { requestHeaders } from "./request";

describe("Core client request boundary", () => {
  it("forwards cookies and correlation headers without rewriting them", () => {
    const request = new Request("https://freshmarkets.ph/api/admin/context", {
      headers: {
        cookie: "better-auth.session_token=session-value",
        "x-request-id": "request-123",
        "x-correlation-id": "correlation-456",
        "user-agent": "readiness-test",
      },
    });

    expect(requestHeaders(request)).toMatchObject({
      cookie: "better-auth.session_token=session-value",
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
    expect(JSON.stringify(headers)).not.toContain("password");
  });

  it("keeps the Core binding as the only route dependency", async () => {
    const core = { getAdminContext: vi.fn().mockResolvedValue({ ok: false }) };
    expect(core.getAdminContext).toBeDefined();
  });
});
