import type {
  AdminRoleListRequest,
  AdminRolePage,
  AdminRoleSummary,
  Capability,
  RpcResult,
} from "@freshmarkets/contracts";
import { isAdminCapability } from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

type RoleRow = {
  roleId: string;
  code: string;
  name: string;
  description: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
};

export async function loadRoleCapabilities(
  deps: StaffAdministrationDeps,
  roleIds: ReadonlyArray<string>,
): Promise<Map<string, Set<Capability>>> {
  const map = new Map<string, Set<Capability>>();
  if (roleIds.length === 0) return map;
  for (const roleId of roleIds) map.set(roleId, new Set());
  const placeholders = roleIds.map(() => "?").join(",");
  const rows = await deps.db
    .prepare(
      `SELECT rp.role_id AS roleId, p.code AS code FROM role_permission rp
       JOIN permission p ON p.id = rp.permission_id
       WHERE rp.role_id IN (${placeholders})`,
    )
    .bind(...roleIds)
    .all<{ roleId: string; code: string }>();
  for (const row of rows.results) {
    if (isAdminCapability(row.code)) map.get(row.roleId)?.add(row.code);
  }
  return map;
}

export async function readRoleDetail(
  deps: StaffAdministrationDeps,
  roleId: string,
  requestId: string,
): Promise<RpcResult<AdminRoleSummary>> {
  const row = await deps.db
    .prepare("SELECT id AS roleId, code, name, description, status, version FROM role WHERE id = ?")
    .bind(roleId)
    .first<RoleRow>();
  if (!row) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Role not found", requestId } };
  }
  const capabilities = (await loadRoleCapabilities(deps, [row.roleId])).get(row.roleId)!;
  return {
    ok: true,
    value: {
      roleId: row.roleId,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status,
      capabilityCodes: [...capabilities].sort(),
      version: row.version,
    },
    requestId,
  };
}

/** Bounded keyset listing of roles ordered by code, for global staff readers. */
export async function listAdminRoles(
  deps: StaffAdministrationDeps,
  request: AdminRoleListRequest,
): Promise<RpcResult<AdminRolePage>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursorCode: string | null = null;
  if (request.cursor !== undefined) {
    const decoded = decodeStaffCursor(request.cursor);
    cursorCode = decoded?.id ?? null;
    if (!cursorCode) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clause = cursorCode ? "WHERE code > ?" : "";
  const binds = cursorCode ? [cursorCode] : [];
  const rows = await deps.db
    .prepare(
      `SELECT id AS roleId, code, name, description, status, version FROM role
       ${clause} ORDER BY code ASC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<RoleRow>();

  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const capabilities = await loadRoleCapabilities(
    deps,
    pageRows.map((row) => row.roleId),
  );
  const items: AdminRoleSummary[] = pageRows.map((row) => ({
    roleId: row.roleId,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    capabilityCodes: [...capabilities.get(row.roleId)!].sort(),
    version: row.version,
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeStaffCursor({ createdAt: 0, id: last.code }) : null;

  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}
