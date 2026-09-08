import { invitationGrantStatements } from "../../iam/infrastructure/staff-invitation-repository";
import {
  invitationNotificationStatements,
  cancelPendingInvitationNotificationStatements,
} from "../../notifications/application/invitation-notifications";
import type {
  AdminStaffInviteRequest,
  AdminStaffInvitationRevokeRequest,
  AdminStaffInvitationView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { z } from "@freshmarkets/validation";
import {
  beginStaffAdministrationWrite,
  completeStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const INVITE_SCOPE = "admin.staff.invite";
const INVITATION_REVOKE_SCOPE = "admin.staff.invitation.revoke";
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const invitationResultSchema = z.object({
  invitationId: z.string(),
  // Older creation snapshots predate the version field; creation was always version 1.
  version: z.number().int().positive().default(1),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]),
  invitedByStaffId: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

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
    version: row.version,
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

/**
 * Create a durable staff invitation: one PENDING record per normalized email,
 * 14-day expiry, idempotent by caller key. Identity provisioning from an
 * invitation uses verified identity and the explicit saved grants.
 */
export async function inviteAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffInviteRequest,
): Promise<RpcResult<AdminStaffInvitationView>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const email = request.email.trim().toLowerCase(),
    displayName = request.displayName.trim();
  if (!displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return failure(
      "VALIDATION_FAILED",
      "A display name and valid email are required",
      request.requestId,
    );
  const hash = await requestHash({
    email,
    displayName,
    roleIds: request.roleIds,
    scopes: request.scopes,
  });
  async function replay(): Promise<RpcResult<AdminStaffInvitationView> | null> {
    const saved = await findIdempotencyRecord(deps.db, INVITE_SCOPE, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.resultReference) {
      if (saved.resultType !== "staff_invitation_snapshot") {
        const row = await readInvitation(deps.db, saved.resultReference);
        return row
          ? { ok: true, value: toView(row), requestId: request.requestId }
          : failure("INTERNAL_ERROR", "Saved invitation result is unavailable", request.requestId);
      }
      let value: unknown;
      try {
        value = JSON.parse(saved.resultReference);
      } catch {
        return failure(
          "INTERNAL_ERROR",
          "Saved invitation result is unavailable",
          request.requestId,
        );
      }
      const parsed = invitationResultSchema.safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data, requestId: request.requestId }
        : failure("INTERNAL_ERROR", "Saved invitation result is unavailable", request.requestId);
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const now = Date.now(),
    invitationId = crypto.randomUUID();
  const value: AdminStaffInvitationView = {
    invitationId,
    version: 1,
    email,
    displayName,
    status: "PENDING",
    invitedByStaffId: access.value.staffId,
    expiresAt: new Date(now + INVITATION_TTL_MS).toISOString(),
    createdAt: new Date(now).toISOString(),
  };
  try {
    await deps.db.batch([
      ...beginStaffAdministrationWrite(deps.db, {
        ...access.value,
        scope: INVITE_SCOPE,
        key: request.idempotencyKey,
        hash,
        resultType: "staff_invitation_snapshot",
        now,
      }),
      deps.db
        .prepare(
          "INSERT INTO staff_invitation(id,email_normalized,display_name,status,invited_by_staff_id,expires_at,version,idempotency_key,created_at,updated_at) VALUES (?,?,?,'PENDING',?,?,1,?,?,?)",
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
      requireStaffWrite(deps.db),
      ...invitationGrantStatements(deps.db, invitationId, request.roleIds, request.scopes),
      ...invitationNotificationStatements(deps.db, "staff", invitationId, now),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.INVITED",
        resourceType: "staff_invitation",
        resourceId: invitationId,
        details: { email, displayName },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireStaffWrite(deps.db),
      ...completeStaffAdministrationWrite(deps.db, {
        scope: INVITE_SCOPE,
        key: request.idempotencyKey,
        hash,
        result: value,
        now,
      }),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "The invitation could not be created; refresh access and retry the same request",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}

/** Revoke the reviewed invitation version with current authority and required effects. */
export async function revokeAdminStaffInvitation(
  deps: StaffAdministrationDeps,
  request: AdminStaffInvitationRevokeRequest,
): Promise<RpcResult<AdminStaffInvitationView>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (!reason)
    return failure("VALIDATION_FAILED", "A revocation reason is required", request.requestId);
  const existing = await readInvitation(deps.db, request.invitationId);
  if (!existing) return failure("NOT_FOUND", "Invitation not found", request.requestId);
  const existingView = toView(existing);
  const hash = await requestHash({
    invitationId: request.invitationId,
    reason,
    expectedVersion: request.expectedVersion,
  });
  async function replay(): Promise<RpcResult<AdminStaffInvitationView> | null> {
    const saved = await findIdempotencyRecord(
      deps.db,
      INVITATION_REVOKE_SCOPE,
      request.idempotencyKey,
    );
    if (!saved) return null;
    if (
      saved.status === "SUCCEEDED" &&
      saved.resultType === INVITATION_REVOKE_SCOPE &&
      saved.resultReference === request.invitationId
    ) {
      const legacyHash = await requestHash({ invitationId: request.invitationId, reason });
      if (saved.requestHash === legacyHash)
        return { ok: true, value: existingView, requestId: request.requestId };
    }
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.resultReference) {
      if (saved.resultType !== "revoked_staff_invitation_snapshot")
        return { ok: true, value: existingView, requestId: request.requestId };
      let value: unknown;
      try {
        value = JSON.parse(saved.resultReference);
      } catch {
        return failure(
          "INTERNAL_ERROR",
          "Saved revocation result is unavailable",
          request.requestId,
        );
      }
      const parsed = invitationResultSchema.safeParse(value);
      return parsed.success
        ? { ok: true, value: parsed.data, requestId: request.requestId }
        : failure("INTERNAL_ERROR", "Saved revocation result is unavailable", request.requestId);
    }
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  if (existing.status !== "PENDING")
    return failure(
      "VALIDATION_FAILED",
      "Only pending invitations can be revoked",
      request.requestId,
    );
  if (existing.version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Invitation changed; refresh before revoking",
      request.requestId,
    );
  const now = Date.now();
  const value: AdminStaffInvitationView = {
    ...toView(existing),
    status: "REVOKED",
    version: existing.version + 1,
  };
  try {
    await deps.db.batch([
      ...beginStaffAdministrationWrite(deps.db, {
        ...access.value,
        scope: INVITATION_REVOKE_SCOPE,
        key: request.idempotencyKey,
        hash,
        resultType: "revoked_staff_invitation_snapshot",
        now,
      }),
      deps.db
        .prepare(
          "UPDATE staff_invitation SET status='REVOKED',version=version+1,updated_at=? WHERE id=? AND version=? AND status='PENDING'",
        )
        .bind(now, request.invitationId, request.expectedVersion),
      requireStaffWrite(deps.db),
      ...cancelPendingInvitationNotificationStatements(deps.db, "staff", request.invitationId, now),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.INVITATION_REVOKED",
        resourceType: "staff_invitation",
        resourceId: request.invitationId,
        reason,
        before: { status: existing.status, version: existing.version },
        after: { status: "REVOKED", version: value.version },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireStaffWrite(deps.db),
      ...completeStaffAdministrationWrite(deps.db, {
        scope: INVITATION_REVOKE_SCOPE,
        key: request.idempotencyKey,
        hash,
        result: value,
        now,
      }),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "The invitation changed or could not be revoked; refresh and retry the same request",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}
