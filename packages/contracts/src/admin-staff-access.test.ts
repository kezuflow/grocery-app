import { expect, it } from "vitest";
import {
  adminRoleStatuses,
  adminStaffAccessActions,
  adminStaffInvitationStatuses,
} from "./admin-staff-access";

it("publishes the closed staff, invitation, role, and action vocabularies", () => {
  expect(adminStaffInvitationStatuses).toEqual(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]);
  expect(adminRoleStatuses).toEqual(["ACTIVE", "ARCHIVED"]);
  expect(adminStaffAccessActions).toEqual(["ACTIVATE", "SUSPEND"]);
});
