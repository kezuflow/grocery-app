import { describe, expect, it } from "vitest";
import {
  adminRoleStatuses,
  adminStaffAccessActions,
  adminStaffInvitationStatuses,
  type AdminRoleDetail,
  type AdminStaffDetail,
  type AdminStaffInvitationView,
  type CapabilityDefinitionView,
  type SessionRevocationResult,
} from "./admin-staff-access";

describe("staff access contracts", () => {
  it("publishes the closed staff, invitation, role, and action vocabularies", () => {
    expect(adminStaffInvitationStatuses).toEqual(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]);
    expect(adminRoleStatuses).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(adminStaffAccessActions).toEqual(["ACTIVATE", "SUSPEND"]);
  });

  it("keeps staff, role, and capability payloads as purpose-built DTOs", () => {
    void ({
      staffId: "staff-1",
      authUserId: "auth-1",
      displayName: "Ops Admin",
      email: "ops@example.com",
      status: "active",
      roleCodes: ["operations_admin"],
      capabilityCodes: ["audit.read", "staff.manage"],
      scopes: [{ kind: "global" }],
      version: 3,
      createdAt: "2026-08-27T00:00:00.000Z",
    } satisfies AdminStaffDetail);
    void ({
      roleId: "role-1",
      code: "operations_admin",
      name: "Operations administrator",
      description: "Operational read and manage capabilities.",
      status: "ACTIVE",
      capabilityCodes: ["orders.read"],
      version: 1,
    } satisfies AdminRoleDetail);
    void ({
      invitationId: "inv-1",
      email: "new-staff@example.com",
      displayName: "New Staff",
      status: "PENDING",
      invitedByStaffId: "staff-1",
      expiresAt: "2026-09-10T00:00:00.000Z",
      createdAt: "2026-08-27T00:00:00.000Z",
    } satisfies AdminStaffInvitationView);
    void ({ code: "audit.read", description: "Read the audit log" } satisfies CapabilityDefinitionView);
    void ({ revokedSessionCount: 2 } satisfies SessionRevocationResult);
  });
});
