import type {
  AdminStaffInvitationListRequest,
  AdminStaffInvitationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

type InvitationRow = {
  id: string;
  email_normalized: string;
  display_name: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  invited_by_staff_id: string | null;
  expires_at: number;
  created_at: number;
};

/** Bounded invitation queue for the Staff workspace, global readers only. */
export async function listAdminStaffInvitations(
  deps: StaffAdministrationDeps,
  request: AdminStaffInvitationListRequest,
): Promise<RpcResult<AdminStaffInvitationPage>> {
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

  const clause = cursor ? "WHERE (created_at < ? OR (created_at = ? AND id < ?))" : "";
  const binds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const rows = await deps.db
    .prepare(
      `SELECT id, email_normalized, display_name, status, invited_by_staff_id, expires_at, created_at
       FROM staff_invitation
       ${clause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<InvitationRow>();

  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map((row) => ({
    invitationId: row.id,
    email: row.email_normalized,
    displayName: row.display_name,
    status: row.status,
    invitedByStaffId: row.invited_by_staff_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }));
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.created_at, id: last.id }) : null;

  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}
