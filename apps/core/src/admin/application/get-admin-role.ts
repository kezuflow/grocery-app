import type { AdminRoleDetailRequest, AdminRoleSummary, RpcResult } from "@freshmarkets/contracts";
import { readRoleDetail } from "./list-admin-roles";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

/** One role with its canonical capability set, for global staff readers. */
export async function getAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleDetailRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.read");
  if (!access.ok) return access;
  return readRoleDetail(deps, request.roleId, request.requestId);
}
