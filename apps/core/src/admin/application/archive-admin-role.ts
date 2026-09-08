import type { AdminRoleArchiveRequest, AdminRoleSummary, RpcResult } from "@freshmarkets/contracts";
import type { StaffAdministrationDeps } from "./staff-administration-access";
import { applyAdminRoleChange } from "./update-admin-role";

/** Archive prevents new assignment; retained role history and existing grants are preserved. */
export function archiveAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleArchiveRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  return applyAdminRoleChange(deps, request, { kind: "archive", reason: request.reason.trim() });
}
