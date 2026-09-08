import type {
  AdminStaffAccessChangeRequest,
  AdminStaffDetail,
  AdminStaffUpdateRequest,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  beginStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import {
  completeStaffCommandReceipt,
  staffCommandReceiptSchema,
} from "../../iam/infrastructure/staff-command-receipt";
import {
  readStaffDetail,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

type StaffChange =
  | { kind: "rename"; displayName: string }
  | { kind: "access"; action: "ACTIVATE" | "SUSPEND"; reason: string };

async function changeStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffUpdateRequest | AdminStaffAccessChangeRequest,
  change: StaffChange,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  if (change.kind === "rename" ? !change.displayName : !change.reason)
    return failure(
      "VALIDATION_FAILED",
      change.kind === "rename"
        ? "A display name is required"
        : "A reason is required for access changes",
      request.requestId,
    );
  const scope = change.kind === "rename" ? "admin.staff.update" : "admin.staff.access";
  const hash = await requestHash({
    staffId: request.staffId,
    expectedVersion: request.expectedVersion,
    ...(change.kind === "rename"
      ? { displayName: change.displayName }
      : { action: change.action, reason: change.reason }),
  });
  async function replay(): Promise<RpcResult<AdminStaffDetail> | null> {
    const saved = await findIdempotencyRecord(deps.db, scope, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    if (saved.resultType === scope && saved.resultReference === request.staffId)
      return readStaffDetail(deps, request.staffId, request.requestId);
    if (saved.resultType === "staff_change_snapshot" && saved.resultReference) {
      try {
        const value: unknown = JSON.parse(saved.resultReference);
        const parsed = staffCommandReceiptSchema.safeParse(value);
        if (parsed.success && parsed.data.staffId === request.staffId)
          return { ok: true, value: parsed.data, requestId: request.requestId };
      } catch {
        /* Malformed retained evidence must not cause another mutation. */
      }
    }
    return failure("INTERNAL_ERROR", "Saved staff result is unavailable", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const current = await deps.db
    .prepare("SELECT display_name,status,version FROM staff_identity WHERE id=?")
    .bind(request.staffId)
    .first<{ display_name: string; status: "active" | "suspended"; version: number }>();
  if (!current) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  const nextStatus =
    change.kind === "access" && change.action === "SUSPEND" ? "suspended" : "active";
  if (change.kind === "access" && current.status === nextStatus)
    return failure("VALIDATION_FAILED", `Staff is already ${nextStatus}`, request.requestId);
  if (current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  const now = Date.now();
  try {
    await deps.db.batch([
      ...beginStaffAdministrationWrite(deps.db, {
        ...access.value,
        scope,
        key: request.idempotencyKey,
        hash,
        resultType: "staff_change_snapshot",
        now,
      }),
      change.kind === "rename"
        ? deps.db
            .prepare(
              "UPDATE staff_identity SET display_name=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND display_name=? AND status=?",
            )
            .bind(
              change.displayName,
              now,
              request.staffId,
              request.expectedVersion,
              current.display_name,
              current.status,
            )
        : deps.db
            .prepare(
              "UPDATE staff_identity SET status=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=?",
            )
            .bind(nextStatus, now, request.staffId, request.expectedVersion, current.status),
      requireStaffWrite(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: change.kind === "rename" ? "STAFF.UPDATED" : "STAFF.ACCESS_CHANGED",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        ...(change.kind === "access" ? { reason: change.reason } : {}),
        before:
          change.kind === "rename"
            ? { displayName: current.display_name }
            : { status: current.status },
        after:
          change.kind === "rename" ? { displayName: change.displayName } : { status: nextStatus },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireStaffWrite(deps.db),
      ...completeStaffCommandReceipt(deps.db, {
        staffId: request.staffId,
        scope,
        key: request.idempotencyKey,
        hash,
        now,
      }),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "Staff changed or the command could not be recorded; refresh and retry the same request",
        request.requestId,
      )
    );
  }
  return (
    (await replay()) ??
    failure("INTERNAL_ERROR", "Saved staff result is unavailable", request.requestId)
  );
}

export function updateAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffUpdateRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  return changeStaff(deps, request, { kind: "rename", displayName: request.displayName.trim() });
}

export function changeAdminStaffAccess(
  deps: StaffAdministrationDeps,
  request: AdminStaffAccessChangeRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  return changeStaff(deps, request, {
    kind: "access",
    action: request.action,
    reason: request.reason.trim(),
  });
}
