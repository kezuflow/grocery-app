import type {
  AdminStaffInviteRequest,
  AdminStaffInvitationRevokeRequest,
  AdminStaffInvitationView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const INVITE_SCOPE = "admin.staff.invite";
const INVITATION_REVOKE_SCOPE = "admin.staff.invitation.revoke";
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

type InvitationRow = {
  id: string;
  email_normalized: string;
  display_name: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  invited_by_staff_id: string | null;
  expires_at: number;
  version: number;
  created_at: number;
};

function toView(row: InvitationRow): AdminStaffInvitationView {
  return {
    invitationId: row.id,
    email: row.email_normalized,
    displayName: row.display_name,
    status: row.status,
    invitedByStaffId: row.invited_by_staff_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function readInvitation(
  database: D1Database,
  invitationId: string,
): Promise<InvitationRow | null> {
  return database
    .prepare(
      "SELECT id, email_normalized, display_name, status, invited_by_staff_id, expires_at, version, created_at FROM staff_invitation WHERE id = ?",
    )
    .bind(invitationId)
    .first<InvitationRow>();
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string | null,
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

/**
 * Create a durable staff invitation: one PENDING record per normalized email,
 * 14-day expiry, idempotent by caller key. Identity provisioning from an
 * invitation is a later, separately approved flow.
 */
export async function inviteAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffInviteRequest,
): Promise<RpcResult<AdminStaffInvitationView>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const email = request.email.trim().toLowerCase();
  const displayName = request.displayName.trim();
  if (displayName === "" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return failure(
      "VALIDATION_FAILED",
      "A display name and valid email are required",
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    INVITE_SCOPE,
    request.idempotencyKey,
    { email, displayName },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const existing = await readInvitation(deps.db, claim.existing.resultReference);
      if (existing) return { ok: true, value: toView(existing), requestId: request.requestId };
    }
    return failure("CONFLICT", "The invitation command is still processing", request.requestId);
  }

  const invitationId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          `INSERT INTO staff_invitation (id, email_normalized, display_name, status, invited_by_staff_id,
                                         expires_at, version, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, 'PENDING', ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          invitationId,
          email,
          displayName,
          access.value.staffId,
          now + INVITATION_TTL_MS,
          request.idempotencyKey,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.INVITED",
        resourceType: "staff_invitation",
        resourceId: invitationId,
        details: { email, displayName },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, INVITE_SCOPE, request.idempotencyKey, invitationId, now),
    ]);
  } catch (error) {
    log("error", "admin.staff.invite_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, INVITE_SCOPE, request.idempotencyKey);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      return failure(
        "CONFLICT",
        "A pending invitation for this email already exists",
        request.requestId,
      );
    }
    return failure("CONFLICT", "The invitation could not be created", request.requestId);
  }

  const created = await readInvitation(deps.db, invitationId);
  if (!created) {
    return failure("INTERNAL_ERROR", "The invitation could not be read back", request.requestId);
  }
  return { ok: true, value: toView(created), requestId: request.requestId };
}

/** Revoke a PENDING invitation with a required reason; audited and idempotent. */
export async function revokeAdminStaffInvitation(
  deps: StaffAdministrationDeps,
  request: AdminStaffInvitationRevokeRequest,
): Promise<RpcResult<AdminStaffInvitationView>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  if (request.reason.trim() === "") {
    return failure("VALIDATION_FAILED", "A revocation reason is required", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    INVITATION_REVOKE_SCOPE,
    request.idempotencyKey,
    { invitationId: request.invitationId, reason: request.reason.trim() },
  );
  const existing = await readInvitation(deps.db, request.invitationId);
  if (!existing) return failure("NOT_FOUND", "Invitation not found", request.requestId);
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return { ok: true, value: toView(existing), requestId: request.requestId };
    }
    return failure("CONFLICT", "The revocation command is still processing", request.requestId);
  }
  if (existing.status !== "PENDING") {
    await idempotencyFailed(deps.db, INVITATION_REVOKE_SCOPE, request.idempotencyKey);
    return failure(
      "VALIDATION_FAILED",
      "Only pending invitations can be revoked",
      request.requestId,
    );
  }

  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE staff_invitation SET status='REVOKED', updated_at=?, version=version+1 WHERE id=? AND status='PENDING' AND version=?",
        )
        .bind(now, request.invitationId, existing.version),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.INVITATION_REVOKED",
        resourceType: "staff_invitation",
        resourceId: request.invitationId,
        reason: request.reason.trim(),
        before: { status: existing.status },
        after: { status: "REVOKED" },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(
        deps.db,
        INVITATION_REVOKE_SCOPE,
        request.idempotencyKey,
        request.invitationId,
        now,
      ),
    ]);
  } catch (error) {
    log("error", "admin.staff.invitation_revoke_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, INVITATION_REVOKE_SCOPE, request.idempotencyKey);
    return failure("CONFLICT", "The invitation could not be revoked", request.requestId);
  }

  const revoked = await readInvitation(deps.db, request.invitationId);
  if (!revoked)
    return failure("INTERNAL_ERROR", "The invitation could not be read back", request.requestId);
  return { ok: true, value: toView(revoked), requestId: request.requestId };
}
