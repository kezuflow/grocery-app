import type {
  AdminRoleArchiveRequest,
  AdminRoleSummary,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { readRoleDetail } from "./list-admin-roles";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const SCOPE = "admin.roles.archive";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Archive a role: history and assignments are preserved, archived roles can
 * never be assigned again, and there is no delete path.
 */
export async function archiveAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleArchiveRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "An archive reason is required", request.requestId);
  }

  const current = await deps.db
    .prepare("SELECT id, status, version FROM role WHERE id = ?")
    .bind(request.roleId)
    .first<{ id: string; status: "ACTIVE" | "ARCHIVED"; version: number }>();
  if (!current) return failure("NOT_FOUND", "Role not found", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, SCOPE, request.idempotencyKey, {
    roleId: request.roleId,
    reason,
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
      return readRoleDetail(deps, request.roleId, request.requestId);
    }
    return failure("CONFLICT", "The archive command is still processing", request.requestId);
  }
  const idempotencyFailed = (): Promise<unknown> =>
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, request.idempotencyKey)
      .run();

  if (current.status !== "ACTIVE") {
    await idempotencyFailed();
    return failure("VALIDATION_FAILED", "Role is already archived", request.requestId);
  }

  const appliedGuard = "EXISTS (SELECT 1 FROM role WHERE id=? AND status='ARCHIVED' AND version=?)";
  const appliedGuardBinds = [request.roleId, request.expectedVersion + 1];
  let batchResults: D1Result[];
  try {
    batchResults = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE role SET status='ARCHIVED', version=version+1 WHERE id=? AND status='ACTIVE' AND version=?",
        )
        .bind(request.roleId, request.expectedVersion),
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "ROLE.ARCHIVED",
          resourceType: "role",
          resourceId: request.roleId,
          reason,
          before: { status: "ACTIVE" },
          after: { status: "ARCHIVED" },
          correlationId: request.requestId,
          occurredAt: now,
        },
        { clause: appliedGuard, binds: appliedGuardBinds },
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${appliedGuard}`,
        )
        .bind(request.roleId, now, SCOPE, request.idempotencyKey, ...appliedGuardBinds),
    ]);
  } catch {
    await idempotencyFailed();
    return failure("CONFLICT", "The role archive could not be recorded", request.requestId);
  }
  if ((batchResults[0]?.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed();
    return failure("STALE_VERSION", "Role changed; refresh before retrying", request.requestId);
  }
  return readRoleDetail(deps, request.roleId, request.requestId);
}
