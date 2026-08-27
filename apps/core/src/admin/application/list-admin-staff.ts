import type {
  AdminStaffListRequest,
  AdminStaffPage,
  AdminStaffSummary,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { isAdminCapability, type Capability } from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

type StaffRow = {
  staffId: string;
  authUserId: string;
  displayName: string;
  email: string;
  status: "active" | "suspended";
  version: number;
  createdAt: number;
};

function toScope(row: { scope_kind: string; market_id: string | null; location_id: string | null }): Scope | null {
  if (row.scope_kind === "global") return { kind: "global" };
  if (row.scope_kind === "market" && row.market_id) return { kind: "market", marketId: row.market_id };
  if (row.scope_kind === "location" && row.location_id) {
    return { kind: "location", locationId: row.location_id };
  }
  return null;
}

export async function loadStaffRelations(
  deps: StaffAdministrationDeps,
  staffIds: ReadonlyArray<string>,
): Promise<
  Map<
    string,
    { roleCodes: Set<string>; capabilityCodes: Set<Capability>; scopes: Scope[] }
  >
> {  const relations = new Map<
    string,
    { roleCodes: Set<string>; capabilityCodes: Set<Capability>; scopes: Scope[] }
  >();
  if (staffIds.length === 0) return relations;
  const placeholders = staffIds.map(() => "?").join(",");
  const binds = [...staffIds];

  const roles = await deps.db
    .prepare(
      `SELECT sr.staff_id AS staffId, r.code AS code FROM staff_role sr
       JOIN role r ON r.id = sr.role_id WHERE sr.staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string; code: string }>();
  const capabilities = await deps.db
    .prepare(
      `SELECT sr.staff_id AS staffId, p.code AS code FROM staff_role sr
       JOIN role_permission rp ON rp.role_id = sr.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE sr.staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string; code: string }>();
  const scopes = await deps.db
    .prepare(
      `SELECT staff_id AS staffId, scope_kind, market_id, location_id FROM staff_scope
       WHERE staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string; scope_kind: string; market_id: string | null; location_id: string | null }>();

  for (const staffId of staffIds) {
    relations.set(staffId, { roleCodes: new Set(), capabilityCodes: new Set(), scopes: [] });
  }
  for (const row of roles.results) relations.get(row.staffId)?.roleCodes.add(row.code);
  for (const row of capabilities.results) {
    if (isAdminCapability(row.code)) relations.get(row.staffId)?.capabilityCodes.add(row.code);
  }
  for (const row of scopes.results) {
    const scope = toScope(row);
    if (scope) relations.get(row.staffId)?.scopes.push(scope);
  }
  return relations;
}

/** Bounded keyset listing of staff identities for global staff readers. */
export async function listAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffListRequest,
): Promise<RpcResult<AdminStaffPage>> {
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
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
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

  const clause = cursor
    ? "WHERE (s.created_at < ? OR (s.created_at = ? AND s.id < ?))"
    : "";
  const binds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const rows = await deps.db
    .prepare(
      `SELECT s.id AS staffId, s.auth_user_id AS authUserId, s.display_name AS displayName,
              u.email AS email, s.status, s.version, s.created_at AS createdAt
       FROM staff_identity s JOIN user u ON u.id = s.auth_user_id
       ${clause}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<StaffRow>();

  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const relations = await loadStaffRelations(
    deps,
    pageRows.map((row) => row.staffId),
  );
  const items: AdminStaffSummary[] = pageRows.map((row) => {
    const relation = relations.get(row.staffId)!;
    return {
      staffId: row.staffId,
      authUserId: row.authUserId,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      roleCodes: [...relation.roleCodes].sort(),
      capabilityCodes: [...relation.capabilityCodes].sort(),
      scopes: relation.scopes,
      version: row.version,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  });
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.staffId }) : null;

  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}
