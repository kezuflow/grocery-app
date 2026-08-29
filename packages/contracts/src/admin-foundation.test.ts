import { describe, expect, it } from "vitest";
import {
  adminCapabilityCodes,
  adminNavigationSectionCodes,
  isAdminCapability,
  type AdminContextView,
  type AdminAuditEventPage,
} from "./admin-foundation";

describe("admin foundation contracts", () => {
  it("publishes the closed canonical capability vocabulary", () => {
    expect(adminCapabilityCodes).toContain("customers.read");
    expect(adminCapabilityCodes).toContain("inventory.adjust");
    expect(adminCapabilityCodes).toContain("analytics.read");
    expect(isAdminCapability("staff.manage")).toBe(true);
    expect(isAdminCapability("staff:manage")).toBe(false);
    expect(adminNavigationSectionCodes).toEqual([
      "overview",
      "commerce",
      "operations",
      "finance",
      "administration",
    ]);
  });

  it("keeps context and audit as purpose-built DTOs", () => {
    void ({
      staffId: "staff-1",
      displayName: "Admin",
      email: "admin@example.com",
      capabilities: ["audit.read"],
      scopes: [{ kind: "global" }],
      navigation: [
        {
          code: "audit",
          label: "Audit log",
          href: "/admin/audit",
          section: "administration",
          parentCode: null,
          kind: "workspace",
        },
      ],
      environment: "test",
    } satisfies AdminContextView);
    void ({ items: [], nextCursor: null } satisfies AdminAuditEventPage);
  });
});
