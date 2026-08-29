import type {
  AdminStaffSessionRevocationRequest,
  AppErrorCode,
  RpcResult,
  SessionRevocationResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency, findIdempotencyRecord } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const SCOPE = "admin.staff.sessions.revoke";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Revoke every Better Auth session for the staff member's linked user. The
 * runtime uses the minimal Better Auth build whose server API does not expose
 * administrative revocation, so the command deletes the authentication
 * authority's own session rows — exactly what its sign-out performs — leaving
 * no application-side session state.
 */
export async function revokeAdminStaffSessions(
  deps: StaffAdministrationDeps,
  request: AdminStaffSessionRevocationRequest,
): Promise<RpcResult<SessionRevocationResult>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A revocation reason is required", request.requestId);
  }

  const target = await deps.db
    .prepare("SELECT id, auth_user_id FROM staff_identity WHERE id = ?")
    .bind(request.staffId)
    .first<{ id: string; auth_user_id: string }>();
  if (!target) return failure("NOT_FOUND", "Staff identity not found", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, SCOPE, request.idempotencyKey, {
    staffId: request.staffId,
    reason,
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
      const record = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
      return {
        ok: true,
        value: { revokedSessionCount: Number(record?.resultReference ?? "0") },
        requestId: request.requestId,
      };
    }
    return failure("CONFLICT", "The revocation command is still processing", request.requestId);
  }

  const sessionCount = await deps.db
    .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
    .bind(target.auth_user_id)
    .first<{ count: number }>();
  const revokedSessionCount = sessionCount?.count ?? 0;
  try {
    await deps.db.batch([
      deps.db.prepare("DELETE FROM session WHERE user_id = ?").bind(target.auth_user_id),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.SESSIONS_REVOKED",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        reason,
        details: { revokedSessionCount },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      deps.db
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
        )
        .bind(String(revokedSessionCount), now, SCOPE, request.idempotencyKey),
    ]);
  } catch (error) {
    await deps.db
      .prepare(
        "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), SCOPE, request.idempotencyKey)
      .run();
    const message = error instanceof Error ? error.message : "session revocation failed";
    return failure("INTERNAL_ERROR", message, request.requestId);
  }

  return { ok: true, value: { revokedSessionCount }, requestId: request.requestId };
}
