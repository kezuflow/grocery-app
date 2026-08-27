import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminContext, listAdminScopes, listAdminAuditEvents, getAdminAuditEvent } =
  vi.hoisted(() => ({
    getAdminContext: vi.fn(),
    listAdminScopes: vi.fn(),
    listAdminAuditEvents: vi.fn(),
    getAdminAuditEvent: vi.fn(),
  }));

vi.mock("cloudflare:workers", () => ({
  env: {
    CORE: { getAdminContext, listAdminScopes, listAdminAuditEvents, getAdminAuditEvent },
  },
}));

import { GET as getContext } from "./context/route";
import { GET as getScopes } from "./scopes/route";
import { GET as listAudit } from "./audit/route";
import { GET as getAuditDetail } from "./audit/[audit-event-id]/route";

beforeEach(() => {
  getAdminContext.mockReset();
  listAdminScopes.mockReset();
  listAdminAuditEvents.mockReset();
  getAdminAuditEvent.mockReset();
});

describe("admin foundation BFF routes", () => {
  it("delegates context to Core once, forwarding cookies and a request id", async () => {
    getAdminContext.mockResolvedValue({
      ok: true,
      value: { staffId: "staff-1", capabilities: ["audit.read"] },
      requestId: "core-1",
    });
    const response = await getContext(
      new Request("https://freshmarkets.ph/api/admin/context", {
        headers: { cookie: "session=abc" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      value: { staffId: "staff-1", capabilities: ["audit.read"] },
      requestId: "core-1",
    });
    expect(getAdminContext).toHaveBeenCalledTimes(1);
    const input = getAdminContext.mock.calls[0][0] as {
      requestId: string;
      headers: Record<string, string>;
    };
    expect(typeof input.requestId).toBe("string");
    expect(input.requestId.length).toBeGreaterThan(0);
    expect(input.headers.cookie).toBe("session=abc");
  });

  it("delegates scopes to Core once, forwarding cookies", async () => {
    listAdminScopes.mockResolvedValue({ ok: true, value: [], requestId: "core-2" });
    const response = await getScopes(
      new Request("https://freshmarkets.ph/api/admin/scopes", {
        headers: { cookie: "session=abc" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: [], requestId: "core-2" });
    expect(listAdminScopes).toHaveBeenCalledTimes(1);
    const input = listAdminScopes.mock.calls[0][0] as { headers: Record<string, string> };
    expect(input.headers.cookie).toBe("session=abc");
  });

  it("maps validated audit query parameters and delegates once", async () => {
    listAdminAuditEvents.mockResolvedValue({ ok: true, value: { items: [], nextCursor: null }, requestId: "core-3" });
    const response = await listAudit(
      new Request(
        "https://freshmarkets.ph/api/admin/audit?action=ORDER.ADJUSTED&resourceType=order&actorId=u1&marketId=m1&locationId=l1&from=2026-08-01T00:00:00.000Z&to=2026-08-27T00:00:00.000Z&cursor=abc&limit=25",
        { headers: { cookie: "session=abc" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(listAdminAuditEvents).toHaveBeenCalledTimes(1);
    const input = listAdminAuditEvents.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      action: "ORDER.ADJUSTED",
      resourceType: "order",
      actorId: "u1",
      marketId: "m1",
      locationId: "l1",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-27T00:00:00.000Z",
      cursor: "abc",
      limit: 25,
    });
    expect(typeof input.requestId).toBe("string");
    expect((input.headers as Record<string, string>).cookie).toBe("session=abc");
  });

  it("returns VALIDATION_FAILED without calling Core for a malformed limit", async () => {
    const response = await listAudit(
      new Request("https://freshmarkets.ph/api/admin/audit?limit=abc"),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(listAdminAuditEvents).not.toHaveBeenCalled();
  });

  it("forwards the audit event path id to Core", async () => {
    getAdminAuditEvent.mockResolvedValue({ ok: true, value: { auditEventId: "ev-1" }, requestId: "core-4" });
    const response = await getAuditDetail(
      new Request("https://freshmarkets.ph/api/admin/audit/ev-1", {
        headers: { cookie: "session=abc" },
      }),
      { params: Promise.resolve({ "audit-event-id": "ev-1" }) },
    );
    expect(response.status).toBe(200);
    expect(getAdminAuditEvent).toHaveBeenCalledTimes(1);
    const input = getAdminAuditEvent.mock.calls[0][0] as {
      auditEventId: string;
      headers: Record<string, string>;
    };
    expect(input.auditEventId).toBe("ev-1");
    expect(input.headers.cookie).toBe("session=abc");
  });
});
