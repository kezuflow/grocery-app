import type {
  AdminStaffRolesRequest,
  AdminStaffDetail,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  loadStaffRelations,
  readStaffDetail,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const SCOPE = "admin.staff.roles";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Atomically replace a staff member's role assignments. Every statement in
 * the batch carries the caller's version predicate, so a concurrent identity
 * change turns the whole batch (including its audit evidence and idempotency
 * completion) into a no-op that reads back as STALE_VERSION.
 */
export async function setAdminStaffRoles(
  deps: StaffAdministrationDeps,
  request: AdminStaffRolesRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const target = await deps.db
    .prepare("SELECT id, version FROM staff_identity WHERE id = ?")
    .bind(request.staffId)
    .first<{ id: string; version: number }>();
  if (!target) return failure("NOT_FOUND", "Staff identity not found", request.requestId);

  const uniqueRoleIds = [...new Set(request.roleIds)];
  const before = (await loadStaffRelations(deps, [request.staffId])).get(request.staffId)!;
  let afterCodes: string[] = [];
  if (uniqueRoleIds.length > 0) {
    const placeholders = uniqueRoleIds.map(() => "?").join(",");
    const roles = await deps.db
      .prepare(`SELECT id, code, status FROM role WHERE id IN (${placeholders})`)
      .bind(...uniqueRoleIds)
      .all<{ id: string; code: string; status: "ACTIVE" | "ARCHIVED" }>();
    if (roles.results.length !== uniqueRoleIds.length) {
      return failure("VALIDATION_FAILED", "One or more roles do not exist", request.requestId);
    }
    const archived = roles.results.filter((role) => role.status !== "ACTIVE");
    if (archived.length > 0) {
      return failure("VALIDATION_FAILED", "Archived roles cannot be assigned", request.requestId);
    }
    afterCodes = roles.results.map((role) => role.code).sort();
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, SCOPE, request.idempotencyKey, {
    staffId: request.staffId,
    roleIds: [...uniqueRoleIds].sort(),
    expectedVersion: request.expectedVersion,
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readStaffDetail(deps, request.staffId, request.requestId);
    }
    return failure("CONFLICT", "The role command is still processing", request.requestId);
  }

  const guard = "EXISTS (SELECT 1 FROM staff_identity WHERE id = ? AND version = ?)";
  const guardBinds = [request.staffId, request.expectedVersion];
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`DELETE FROM staff_role WHERE staff_id = ? AND ${guard}`)
      .bind(request.staffId, ...guardBinds),
    ...uniqueRoleIds.map((roleId) =>
      deps.db
        .prepare(`INSERT INTO staff_role (staff_id, role_id) SELECT ?, ? WHERE ${guard}`)
        .bind(request.staffId, roleId, ...guardBinds),
    ),
    auditEventStatement(
      deps.db,
      {
        actorUserId: access.value.authUserId,
        action: "STAFF.ROLES_SET",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        before: { roleCodes: [...before.roleCodes].sort() },
        after: { roleCodes: afterCodes },
        correlationId: request.requestId,
        occurredAt: now,
      },
      { clause: guard, binds: guardBinds },
    ),
    deps.db
      .prepare(
        `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
         WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard}`,
      )
      .bind(request.staffId, now, SCOPE, request.idempotencyKey, ...guardBinds),
  
    deps.db
      .prepare(
        `UPDATE staff_identity SET updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      )
      .bind(now, request.staffId, request.expectedVersion),
];

  await deps.db.batch(statements);
  const after = await deps.db
    .prepare("SELECT version FROM staff_identity WHERE id = ?")
    .bind(request.staffId)
    .first<{ version: number }>();
  if (after?.version !== request.expectedVersion + 1) {
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  }
  return readStaffDetail(deps, request.staffId, request.requestId);
}
