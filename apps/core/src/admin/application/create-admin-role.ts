import {
  adminCapabilityCodes,
  isAdminCapability,
  type AdminRoleCreateRequest,
  type AdminRoleSummary,
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

const SCOPE = "admin.roles.create";
const RESULT_TYPE = "created_role_snapshot";
const roleResultSchema = z.object({
  roleId: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  capabilityCodes: z.array(z.enum(adminCapabilityCodes)),
  version: z.number().int().positive(),
});
function failure(code: AppErrorCode, message: string, requestId: string): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

export async function createAdminRole(
  deps: StaffAdministrationDeps,
  request: AdminRoleCreateRequest,
): Promise<RpcResult<AdminRoleSummary>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const code = request.code.trim(),
    name = request.name.trim(),
    description = request.description.trim();
  const capabilityCodes = [...new Set(request.capabilityCodes)].sort();
  if (!/^[a-z][a-z0-9_.-]*$/.test(code) || !name)
    return failure("VALIDATION_FAILED", "A code and name are required", request.requestId);
  if (!capabilityCodes.every(isAdminCapability))
    return failure(
      "VALIDATION_FAILED",
      "Capabilities must come from the canonical vocabulary",
      request.requestId,
    );
  const hash = await requestHash({ code, name, description, capabilityCodes });
  async function replay(): Promise<RpcResult<AdminRoleSummary> | null> {
    const saved = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.resultReference) {
      if (saved.resultType !== RESULT_TYPE)
        return readRoleDetail(deps, saved.resultReference, request.requestId);
      let value: unknown;
      try {
        value = JSON.parse(saved.resultReference);
      } catch {
        return failure("INTERNAL_ERROR", "Saved role result is unavailable", request.requestId);
      }
      const parsed = roleResultSchema.safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data, requestId: request.requestId }
        : failure("INTERNAL_ERROR", "Saved role result is unavailable", request.requestId);
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const now = Date.now(),
    roleId = crypto.randomUUID();
  const value: AdminRoleSummary = {
    roleId,
    code,
    name,
    description,
    status: "ACTIVE",
    capabilityCodes,
    version: 1,
  };
  const statements = [
    ...beginStaffAdministrationWrite(deps.db, {
      ...access.value,
      scope: SCOPE,
      key: request.idempotencyKey,
      hash,
      resultType: RESULT_TYPE,
      now,
    }),
    deps.db
      .prepare(
        "INSERT INTO role(id,code,name,description,status,version,created_at) VALUES (?,?,?,?,'ACTIVE',1,?)",
      )
      .bind(roleId, code, name, description, now),
    requireStaffWrite(deps.db),
  ];
  for (const capability of capabilityCodes)
    statements.push(
      deps.db
        .prepare(
          "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code=?",
        )
        .bind(roleId, capability),
      requireStaffWrite(deps.db),
    );
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "ROLE.CREATED",
      resourceType: "role",
      resourceId: roleId,
      details: { code, capabilityCodes },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    requireStaffWrite(deps.db),
    ...completeStaffAdministrationWrite(deps.db, {
      scope: SCOPE,
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
        "The role could not be created; refresh access and retry the same request",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}
