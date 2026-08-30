import type {
  AdminStaffListRequest,
  AdminStaffPage,
  AdminStaffSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  loadStaffRelations,
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

  const clause = cursor ? "WHERE (s.created_at < ? OR (s.created_at = ? AND s.id < ?))" : "";
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
