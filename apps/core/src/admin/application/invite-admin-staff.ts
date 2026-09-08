import { invitationGrantStatements } from "../../iam/infrastructure/staff-invitation-repository";
import type {
  AdminStaffInviteRequest,
  AdminStaffInvitationRevokeRequest,
  AdminStaffInvitationView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";
import { z } from "@freshmarkets/validation";
import {
  beginStaffAdministrationWrite,
  completeStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import {
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const INVITE_SCOPE = "admin.staff.invite";
const INVITATION_REVOKE_SCOPE = "admin.staff.invitation.revoke";
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const invitationResultSchema = z.object({
  invitationId: z.string(),
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
    const guard = {
      clause:
        "EXISTS (SELECT 1 FROM staff_invitation WHERE id=? AND status='REVOKED' AND version=?)",
      binds: [request.invitationId, existing.version + 1] as const,
    };
    const results = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE staff_invitation SET status='REVOKED', updated_at=?, version=version+1 WHERE id=? AND status='PENDING' AND version=?",
        )
        .bind(now, request.invitationId, existing.version),
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "STAFF.INVITATION_REVOKED",
          resourceType: "staff_invitation",
          resourceId: request.invitationId,
          reason: request.reason.trim(),
          before: { status: existing.status },
          after: { status: "REVOKED" },
          correlationId: request.requestId,
          occurredAt: now,
        },
        guard,
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard.clause}`,
        )
        .bind(
          request.invitationId,
          now,
          INVITATION_REVOKE_SCOPE,
          request.idempotencyKey,
          ...guard.binds,
        ),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      await idempotencyFailed(deps.db, INVITATION_REVOKE_SCOPE, request.idempotencyKey);
      return failure(
        "CONFLICT",
        "The invitation changed; refresh before retrying",
        request.requestId,
      );
    }
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
