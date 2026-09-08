import type {
  AdminStaffRolesRequest,
  AdminStaffDetail,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  beginStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import { completeStaffCommandReceipt } from "../../iam/infrastructure/staff-command-receipt";
import { replayStaffCommand } from "./staff-command-replay";
import {
  loadStaffRelations,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";
const SCOPE = "admin.staff.roles";
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Replace the reviewed assignment set with current active roles in one guarded transaction. */
export async function setAdminStaffRoles(
  deps: StaffAdministrationDeps,
  request: AdminStaffRolesRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const roleIds = [...new Set(request.roleIds)].sort();
  const hash = await requestHash({
    staffId: request.staffId,
    roleIds,
    expectedVersion: request.expectedVersion,
  });
  const receipt = {
    scope: SCOPE,
    key: request.idempotencyKey,
    hash,
    staffId: request.staffId,
    requestId: request.requestId,
  };
  const prior = await replayStaffCommand(deps, receipt);
  if (prior) return prior;
  const target = await deps.db
    .prepare("SELECT version FROM staff_identity WHERE id=?")
    .bind(request.staffId)
    .first<{ version: number }>();
  if (!target) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  if (target.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  const roles = await deps.db
    .prepare("SELECT id,code,status FROM role WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(roleIds))
    .all<{ id: string; code: string; status: string }>();
  if (roles.results.length !== roleIds.length)
    return failure("VALIDATION_FAILED", "One or more roles do not exist", request.requestId);
  if (roles.results.some((role) => role.status !== "ACTIVE"))
    return failure("VALIDATION_FAILED", "Archived roles cannot be assigned", request.requestId);
  const before = (await loadStaffRelations(deps, [request.staffId])).get(request.staffId);
  if (!before) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  const now = Date.now();
  try {
    await deps.db.batch([
      ...beginStaffAdministrationWrite(deps.db, {
        ...receipt,
        ...access.value,
        resultType: "staff_change_snapshot",
        now,
      }),
      deps.db
        .prepare(
          "UPDATE staff_identity SET updated_at=?,version=version+1 WHERE id=? AND version=?",
        )
        .bind(now, request.staffId, request.expectedVersion),
      requireStaffWrite(deps.db),
      deps.db.prepare("DELETE FROM staff_role WHERE staff_id=?").bind(request.staffId),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -35 WHERE EXISTS(SELECT 1 FROM staff_role WHERE staff_id=?)",
        )
        .bind(request.staffId),
      ...roleIds.flatMap((roleId) => [
        deps.db
          .prepare(
            "INSERT INTO staff_role(staff_id,role_id) SELECT ?,id FROM role WHERE id=? AND status='ACTIVE'",
          )
          .bind(request.staffId, roleId),
        requireStaffWrite(deps.db),
      ]),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.ROLES_SET",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        before: { roleCodes: [...before.roleCodes].sort() },
        after: { roleCodes: roles.results.map((role) => role.code).sort() },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireStaffWrite(deps.db),
      ...completeStaffCommandReceipt(deps.db, { ...receipt, now }),
    ]);
  } catch {
    return (
      (await replayStaffCommand(deps, receipt)) ??
      failure(
        "CONFLICT",
        "Staff or roles changed; refresh and retry the same request",
        request.requestId,
      )
    );
  }
  return (
    (await replayStaffCommand(deps, receipt)) ??
    failure("INTERNAL_ERROR", "Saved staff result is unavailable", request.requestId)
  );
}
