import {
  adminCapabilityCodes,
  isAdminCapability,
  type AdminRoleCapabilitiesRequest,
  type AdminRoleSummary,
  type AdminRoleUpdateRequest,
  type AdminRoleArchiveRequest,
  type AppErrorCode,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  beginStaffAdministrationWrite,
  completeStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import { readRoleDetail } from "./list-admin-roles";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const receiptSchema = z.object({
  roleId: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  capabilityCodes: z.array(z.enum(adminCapabilityCodes)),
  version: z.number().int().positive(),
});
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
type RoleChange =
  | { kind: "profile"; name: string; description: string }
  | { kind: "capabilities"; capabilityCodes: AdminRoleCapabilitiesRequest["capabilityCodes"] }
  | { kind: "archive"; reason: string };

/** The three explicit role transitions share admission, required effects and receipt semantics. */
export async function applyAdminRoleChange(
  deps: StaffAdministrationDeps,
  request: AdminRoleUpdateRequest | AdminRoleCapabilitiesRequest | AdminRoleArchiveRequest,
  change: RoleChange,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  if (change.kind === "profile" && !change.name)
    return failure("VALIDATION_FAILED", "A name is required", request.requestId);
  if (change.kind === "archive" && !change.reason)
    return failure("VALIDATION_FAILED", "An archive reason is required", request.requestId);
  if (change.kind === "capabilities" && !change.capabilityCodes.every(isAdminCapability))
    return failure(
      "VALIDATION_FAILED",
      "Capabilities must come from the canonical vocabulary",
      request.requestId,
    );
  const scope =
    change.kind === "profile"
      ? "admin.roles.update"
      : change.kind === "capabilities"
        ? "admin.roles.capabilities"
        : "admin.roles.archive";
  const payload =
    change.kind === "profile"
      ? { name: change.name, description: change.description }
      : change.kind === "capabilities"
        ? { capabilityCodes: [...change.capabilityCodes].sort() }
        : { reason: change.reason };
  const hash = await requestHash({
    roleId: request.roleId,
    expectedVersion: request.expectedVersion,
    ...payload,
  });
  async function replay(): Promise<RpcResult<AdminRoleSummary> | null> {
    const saved = await findIdempotencyRecord(deps.db, scope, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    if (saved.resultType === scope && saved.resultReference === request.roleId)
      return readRoleDetail(deps, request.roleId, request.requestId);
    if (saved.resultType === "role_change_snapshot" && saved.resultReference) {
      try {
        const value: unknown = JSON.parse(saved.resultReference);
        const parsed = receiptSchema.safeParse(value);
        if (parsed.success && parsed.data.roleId === request.roleId)
          return { ok: true, value: parsed.data, requestId: request.requestId };
      } catch {
        /* Invalid retained evidence cannot authorize another change. */
      }
    }
    return failure("INTERNAL_ERROR", "Saved role result is unavailable", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const detail = await readRoleDetail(deps, request.roleId, request.requestId);
  if (!detail.ok) return detail;
  const current = detail.value;
  if (current.status !== "ACTIVE")
    return failure("VALIDATION_FAILED", "Archived roles cannot be changed", request.requestId);
  if (current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Role changed; refresh before retrying", request.requestId);
  const value: AdminRoleSummary = {
    ...current,
    version: current.version + 1,
    ...(change.kind === "profile"
      ? { name: change.name, description: change.description }
      : change.kind === "capabilities"
        ? { capabilityCodes: [...change.capabilityCodes].sort() }
        : { status: "ARCHIVED" as const }),
  };
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    ...beginStaffAdministrationWrite(deps.db, {
      ...access.value,
      scope,
      key: request.idempotencyKey,
      hash,
      resultType: "role_change_snapshot",
      now,
    }),
    deps.db
      .prepare(
        "UPDATE role SET name=?,description=?,status=?,version=version+1 WHERE id=? AND status='ACTIVE' AND version=?",
      )
      .bind(value.name, value.description, value.status, request.roleId, request.expectedVersion),
    requireStaffWrite(deps.db),
  ];
  if (change.kind === "capabilities")
    statements.push(
      deps.db.prepare("DELETE FROM role_permission WHERE role_id=?").bind(request.roleId),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -35 WHERE EXISTS(SELECT 1 FROM role_permission WHERE role_id=?)",
        )
        .bind(request.roleId),
      ...change.capabilityCodes.flatMap((code) => [
        deps.db
          .prepare(
            "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code=?",
          )
          .bind(request.roleId, code),
        requireStaffWrite(deps.db),
      ]),
    );
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action:
        change.kind === "profile"
          ? "ROLE.UPDATED"
          : change.kind === "capabilities"
            ? "ROLE.CAPABILITIES_SET"
            : "ROLE.ARCHIVED",
      resourceType: "role",
      resourceId: request.roleId,
      ...(change.kind === "archive" ? { reason: change.reason } : {}),
      before:
        change.kind === "profile"
          ? { name: current.name, description: current.description }
          : change.kind === "capabilities"
            ? { capabilityCodes: current.capabilityCodes }
            : { status: "ACTIVE" },
      after:
        change.kind === "profile"
          ? { name: value.name, description: value.description }
          : change.kind === "capabilities"
            ? { capabilityCodes: value.capabilityCodes }
            : { status: "ARCHIVED" },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    requireStaffWrite(deps.db),
    ...completeStaffAdministrationWrite(deps.db, {
      scope,
      key: request.idempotencyKey,
      hash,
      result: value,
      now,
    }),
  );
  try {
    await deps.db.batch(statements);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "Role or authority changed; refresh and retry the same request",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}

export function updateAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleUpdateRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  return applyAdminRoleChange(deps, request, {
    kind: "profile",
    name: request.name.trim(),
    description: request.description.trim(),
  });
}
export function setAdminRoleCapabilities(
  deps: StaffAdministrationDeps,
  request: AdminRoleCapabilitiesRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  return applyAdminRoleChange(deps, request, {
    kind: "capabilities",
    capabilityCodes: [...new Set(request.capabilityCodes)].sort(),
  });
}
