import type { AdminStaffDetail, AdminStaffDetailRequest, RpcResult } from "@freshmarkets/contracts";
import {
  readStaffDetail,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

/** One staff identity as a purpose-built detail DTO for global staff readers. */
export async function getAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffDetailRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.read");
  if (!access.ok) return access;
  return readStaffDetail(deps, request.staffId, request.requestId);
}
