import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuditEventView } from "@freshmarkets/contracts";
import { AuditDetailView } from "@/app/admin/audit/audit-detail-view";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/audit/audit-1" }));

const event: AdminAuditEventView = {
  auditEventId: "audit-1",
  occurredAt: "2026-08-29T12:00:00.000Z",
  actorId: "staff-1",
  action: "CUSTOMER.ACCESS_DISABLED",
  resourceType: "customer",
  resourceId: "customer-1",
  marketId: null,
  locationId: null,
  reason: "risk review",
  correlationId: "request-1",
  metadata: { token: "[REDACTED]" },
  before: { status: "active" },
  after: { status: "disabled" },
};

describe("audit detail view", () => {
  it("renders sanitized event evidence", () => {
    const markup = renderToStaticMarkup(
      createElement(AuditDetailView, { state: { phase: "ready", event } }),
    );
    expect(markup).toContain("CUSTOMER.ACCESS_DISABLED");
    expect(markup).toContain("[REDACTED]");
    expect(markup).toContain("risk review");
    expect(markup).not.toContain("raw-secret");
  });

  it.each([
    ["NOT_FOUND", "Audit event not found"],
    ["FORBIDDEN", "Audit access denied"],
  ])("renders the %s state", (code, title) => {
    const markup = renderToStaticMarkup(
      createElement(AuditDetailView, {
        state: { phase: "error", code, message: "Unavailable", requestId: "request-2" },
      }),
    );
    expect(markup).toContain(title);
    expect(markup).toContain("request-2");
  });
});
