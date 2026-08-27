import type {
  AdminStaffDetail,
  AdminStaffDetailRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  loadStaffRelations,
} from "./list-admin-staff";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

type StaffRowShape = {
  staffId: string;
  authUserId: string;
  displayName: string;
  email: string;
  status: "active" | "suspended";
  version: number;
  createdAt: number;
};

/** One staff identity as a purpose-built detail DTO for global staff readers. */
export async function getAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffDetailRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.read");
  if (!access.ok) return access;

  const row = await deps.db
    .prepare(
      `SELECT s.id AS staffId, s.auth_user_id AS authUserId, s.display_name AS displayName,
              u.email AS email, s.status, s.version, s.created_at AS createdAt
       FROM staff_identity s JOIN user u ON u.id = s.auth_user_id
       WHERE s.id = ?`,
    )
    .bind(request.staffId)
    .first<StaffRowShape>();
  if (!row) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Staff identity not found",
        requestId: request.requestId,
      },
    };
  }

  const relations = (await loadStaffRelations(deps, [row.staffId])).get(row.staffId)!;
  const detail: AdminStaffDetail = {
    staffId: row.staffId,
    authUserId: row.authUserId,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    roleCodes: [...relations.roleCodes].sort(),
    capabilityCodes: [...relations.capabilityCodes].sort(),
    scopes: relations.scopes,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
  };
  return { ok: true, value: detail, requestId: request.requestId };
}
