import { drizzle } from "drizzle-orm/d1";
import type {
  AcceptStaffInvitationRequest,
  AuthenticatedRequest,
  AppErrorCode,
  RpcResult,
  StaffInvitationOffer,
} from "@freshmarkets/contracts";
import { applicationContextForRequest } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import type { ResolvedApplicationContext } from "../../auth/authorization";
type StaffInvitationDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};
import { claimCommandIdempotency } from "../../idempotency";
import { iamSchema } from "../schema";
import {
  acceptInvitationRecord,
  readStaffInvitationOffer,
} from "../infrastructure/staff-invitation-repository";

function failure(code: AppErrorCode, message: string, requestId: string): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}
async function invitee(deps: StaffInvitationDeps, request: AuthenticatedRequest) {
  const context = await applicationContextForRequest(
    deps.auth,
    drizzle(deps.db, { schema: iamSchema }),
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  const principal = context.value.principal;
  if (!context.value.authenticated || !principal)
    return failure("UNAUTHENTICATED", "Sign in to view your staff invitation", request.requestId);
  if (!principal.emailVerified)
    return failure(
      "FORBIDDEN",
      "Verify your email before accepting staff access",
      request.requestId,
    );
  return { ok: true as const, value: principal, requestId: request.requestId };
}
export async function getMyStaffInvitation(
  deps: StaffInvitationDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<StaffInvitationOffer | null>> {
  const access = await invitee(deps, request);
  if (!access.ok) return access;
  return {
    ok: true,
    value: await readStaffInvitationOffer(deps.db, access.value.email.trim().toLowerCase()),
    requestId: request.requestId,
  };
}
export async function acceptStaffInvitation(
  deps: StaffInvitationDeps,
  request: AcceptStaffInvitationRequest,
): Promise<RpcResult<{ staffId: string }>> {
  const access = await invitee(deps, request);
  if (!access.ok) return access;
  const email = access.value.email.trim().toLowerCase();
  const invitation = await deps.db
    .prepare("SELECT id FROM staff_invitation WHERE id=? AND email_normalized=?")
    .bind(request.invitationId, email)
    .first();
  if (!invitation) return failure("NOT_FOUND", "Staff invitation not found", request.requestId);
  const claim = await claimCommandIdempotency(
    deps.db,
    Date.now,
    "iam.acceptInvitation",
    request.idempotencyKey,
    {
      invitationId: request.invitationId,
      expectedVersion: request.expectedVersion,
      userId: access.value.userId,
    },
  );
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", request.requestId);
    if (claim.existing.status === "SUCCEEDED" && claim.existing.resultReference)
      return {
        ok: true,
        value: { staffId: claim.existing.resultReference },
        requestId: request.requestId,
      };
    return failure("CONFLICT", "Invitation acceptance is processing", request.requestId);
  }
  const staffId = crypto.randomUUID();
  try {
    await acceptInvitationRecord(deps.db, {
      ...request,
      userId: access.value.userId,
      email,
      staffId,
      now: Date.now(),
    });
  } catch {
    await deps.db
      .prepare(
        "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope='iam.acceptInvitation' AND idempotency_key=? AND status='PROCESSING'",
      )
      .bind(Date.now(), request.idempotencyKey)
      .run();
    return failure(
      "CONFLICT",
      "Invitation changed, expired, or its access grants are unavailable; ask your administrator to review it",
      request.requestId,
    );
  }
  return { ok: true, value: { staffId }, requestId: request.requestId };
}
