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
import { requestHash, findIdempotencyRecord } from "../../idempotency";
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
  const hash = await requestHash({
    invitationId: request.invitationId,
    expectedVersion: request.expectedVersion,
    userId: access.value.userId,
  });
  async function replay(): Promise<RpcResult<{ staffId: string }> | null> {
    const saved = await findIdempotencyRecord(
      deps.db,
      "iam.acceptInvitation",
      request.idempotencyKey,
    );
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", request.requestId);
    if (saved.status === "SUCCEEDED" && saved.resultReference)
      return { ok: true, value: { staffId: saved.resultReference }, requestId: request.requestId };
    return null;
  }
  const prior = await replay();
  if (prior) return prior;
  const staffId = crypto.randomUUID();
  try {
    await acceptInvitationRecord(deps.db, {
      ...request,
      userId: access.value.userId,
      requestHash: hash,
      email,
      staffId,
      now: Date.now(),
    });
  } catch {
    const completed = await replay();
    if (completed) return completed;
    return failure(
      "CONFLICT",
      "Invitation changed, expired, or its access grants are unavailable; ask your administrator to review it",
      request.requestId,
    );
  }
  return { ok: true, value: { staffId }, requestId: request.requestId };
}
