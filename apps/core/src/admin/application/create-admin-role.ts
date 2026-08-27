import type {
  AdminRoleCreateRequest,
  AdminRoleSummary,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { isAdminCapability } from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import { readRoleDetail } from "./list-admin-roles";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const SCOPE = "admin.roles.create";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Create an application role restricted to the canonical capability set. */
export async function createAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleCreateRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const code = request.code.trim();
  const name = request.name.trim();
  const description = request.description.trim();
  const capabilityCodes = [...new Set(request.capabilityCodes)];
  if (!/^[a-z][a-z0-9_.-]*$/.test(code) || name === "") {
    return failure("VALIDATION_FAILED", "A code and name are required", request.requestId);
  }
  if (!capabilityCodes.every((capability) => isAdminCapability(capability))) {
    return failure(
      "VALIDATION_FAILED",
      "Capabilities must come from the canonical vocabulary",
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, SCOPE, request.idempotencyKey, {
    code,
    name,
    description,
    capabilityCodes: [...capabilityCodes].sort(),
  });
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      return readRoleDetail(deps, claim.existing.resultReference, request.requestId);
    }
    return failure("CONFLICT", "The create command is still processing", request.requestId);
  }

  const roleId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(
        "INSERT INTO role (id, code, name, description, status, version, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?)",
      )
      .bind(roleId, code, name, description, now),
    ...capabilityCodes.map((capability) =>
      deps.db
        .prepare(
          "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code = ?",
        )
        .bind(roleId, capability),
    ),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "ROLE.CREATED",
      resourceType: "role",
      resourceId: roleId,
      details: { code, capabilityCodes: [...capabilityCodes].sort() },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(roleId, now, SCOPE, request.idempotencyKey),
  ];
  try {
    await deps.db.batch(statements);
  } catch (error) {
    log("error", "admin.roles.create_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await deps.db
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, request.idempotencyKey)
      .run();
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure("CONFLICT", "A role with this code already exists", request.requestId);
    }
    return failure("CONFLICT", "The role could not be created", request.requestId);
  }

  return readRoleDetail(deps, roleId, request.requestId);
}
