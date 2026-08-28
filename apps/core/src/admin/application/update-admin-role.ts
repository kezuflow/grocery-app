import type {
  AdminRoleCapabilitiesRequest,
  AdminRoleSummary,
  AdminRoleUpdateRequest,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { isAdminCapability } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import { loadRoleCapabilities, readRoleDetail } from "./list-admin-roles";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const UPDATE_SCOPE = "admin.roles.update";
const CAPABILITIES_SCOPE = "admin.roles.capabilities";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
};

async function readRoleRow(database: D1Database, roleId: string): Promise<RoleRow | null> {
  return database
    .prepare("SELECT id, code, name, description, status, version FROM role WHERE id = ?")
    .bind(roleId)
    .first<RoleRow>();
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

/** Rename or re-describe an ACTIVE role; version-guarded and audited. */
export async function updateAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleUpdateRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const current = await readRoleRow(deps.db, request.roleId);
  if (!current) return failure("NOT_FOUND", "Role not found", request.requestId);
  if (current.status !== "ACTIVE") {
    return failure("VALIDATION_FAILED", "Archived roles cannot be updated", request.requestId);
  }
  const name = request.name.trim();
  const description = request.description.trim();
  if (name === "") {
    return failure("VALIDATION_FAILED", "A name is required", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    UPDATE_SCOPE,
    request.idempotencyKey,
    { roleId: request.roleId, name, description, expectedVersion: request.expectedVersion },
  );
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
    return failure("CONFLICT", "The update command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare("UPDATE role SET name=?, description=?, version=version+1 WHERE id=? AND version=?")
    .bind(name, description, request.roleId, request.expectedVersion)
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Role changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "ROLE.UPDATED",
      resourceType: "role",
      resourceId: request.roleId,
      before: { name: current.name, description: current.description },
      after: { name, description },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(deps.db, UPDATE_SCOPE, request.idempotencyKey, request.roleId, now),
  ]);
  return readRoleDetail(deps, request.roleId, request.requestId);
}

/** Atomically replace a role's canonical capability set; version-guarded. */
export async function setAdminRoleCapabilities(
  deps: StaffAdministrationDeps,
  request: AdminRoleCapabilitiesRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const current = await readRoleRow(deps.db, request.roleId);
  if (!current) return failure("NOT_FOUND", "Role not found", request.requestId);
  if (current.status !== "ACTIVE") {
    return failure(
      "VALIDATION_FAILED",
      "Archived roles cannot change capabilities",
      request.requestId,
    );
  }
  const capabilityCodes = [...new Set(request.capabilityCodes)];
  if (!capabilityCodes.every((capability) => isAdminCapability(capability))) {
    return failure(
      "VALIDATION_FAILED",
      "Capabilities must come from the canonical vocabulary",
      request.requestId,
    );
  }
  const before = (await loadRoleCapabilities(deps, [request.roleId])).get(request.roleId)!;

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    CAPABILITIES_SCOPE,
    request.idempotencyKey,
    {
      roleId: request.roleId,
      capabilityCodes: [...capabilityCodes].sort(),
      expectedVersion: request.expectedVersion,
    },
  );
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
    return failure("CONFLICT", "The capability command is still processing", request.requestId);
  }

  const guard = "EXISTS (SELECT 1 FROM role WHERE id = ? AND version = ?)";
  const guardBinds = [request.roleId, request.expectedVersion];
  await deps.db.batch([
    deps.db
      .prepare(`DELETE FROM role_permission WHERE role_id = ? AND ${guard}`)
      .bind(request.roleId, ...guardBinds),
    ...capabilityCodes.map((capability) =>
      deps.db
        .prepare(
          "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code = ? AND " +
            guard,
        )
        .bind(request.roleId, capability, ...guardBinds),
    ),
    auditEventStatement(
      deps.db,
      {
        actorUserId: access.value.authUserId,
        action: "ROLE.CAPABILITIES_SET",
        resourceType: "role",
        resourceId: request.roleId,
        before: { capabilityCodes: [...before].sort() },
        after: { capabilityCodes: [...capabilityCodes].sort() },
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
      .bind(request.roleId, now, CAPABILITIES_SCOPE, request.idempotencyKey, ...guardBinds),
    deps.db
      .prepare("UPDATE role SET version = version + 1 WHERE id = ? AND version = ?")
      .bind(request.roleId, request.expectedVersion),
  ]);

  const after = await deps.db
    .prepare("SELECT version FROM role WHERE id = ?")
    .bind(request.roleId)
    .first<{ version: number }>();
  if (after?.version !== request.expectedVersion + 1) {
    return failure("STALE_VERSION", "Role changed; refresh before retrying", request.requestId);
  }
  return readRoleDetail(deps, request.roleId, request.requestId);
}
