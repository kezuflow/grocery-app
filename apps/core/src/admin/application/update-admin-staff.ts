import type {
  AdminStaffAccessChangeRequest,
  AdminStaffDetail,
  AdminStaffUpdateRequest,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  readStaffDetail,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const UPDATE_SCOPE = "admin.staff.update";
const ACCESS_SCOPE = "admin.staff.access";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
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

type StaffRow = {
  id: string;
  display_name: string;
  status: "active" | "suspended";
  version: number;
};

async function readStaffRow(database: D1Database, staffId: string): Promise<StaffRow | null> {
  return database
    .prepare("SELECT id, display_name, status, version FROM staff_identity WHERE id = ?")
    .bind(staffId)
    .first<StaffRow>();
}

/** Rename an application-owned staff identity; version-guarded and audited. */
export async function updateAdminStaff(
  deps: StaffAdministrationDeps,
  request: AdminStaffUpdateRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const displayName = request.displayName.trim();
  if (displayName === "") {
    return failure("VALIDATION_FAILED", "A display name is required", request.requestId);
  }

  const current = await readStaffRow(deps.db, request.staffId);
  if (!current) return failure("NOT_FOUND", "Staff identity not found", request.requestId);

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    UPDATE_SCOPE,
    request.idempotencyKey,
    { staffId: request.staffId, displayName, expectedVersion: request.expectedVersion },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readStaffDetail(deps, request.staffId, request.requestId);
    }
    return failure("CONFLICT", "The update command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare(
      "UPDATE staff_identity SET display_name=?, updated_at=?, version=version+1 WHERE id=? AND version=?",
    )
    .bind(displayName, now, request.staffId, request.expectedVersion)
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "STAFF.UPDATED",
      resourceType: "staff_identity",
      resourceId: request.staffId,
      before: { displayName: current.display_name },
      after: { displayName },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(deps.db, UPDATE_SCOPE, request.idempotencyKey, request.staffId, now),
  ]);
  return readStaffDetail(deps, request.staffId, request.requestId);
}

/** Activate or suspend an application-owned staff identity; audited. */
export async function changeAdminStaffAccess(
  deps: StaffAdministrationDeps,
  request: AdminStaffAccessChangeRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure(
      "VALIDATION_FAILED",
      "A reason is required for access changes",
      request.requestId,
    );
  }

  const current = await readStaffRow(deps.db, request.staffId);
  if (!current) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  const nextStatus = request.action === "SUSPEND" ? "suspended" : "active";
  if (current.status === nextStatus) {
    return failure("VALIDATION_FAILED", `Staff is already ${nextStatus}`, request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    ACCESS_SCOPE,
    request.idempotencyKey,
    {
      staffId: request.staffId,
      action: request.action,
      reason,
      expectedVersion: request.expectedVersion,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      return readStaffDetail(deps, request.staffId, request.requestId);
    }
    return failure("CONFLICT", "The access command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare(
      "UPDATE staff_identity SET status=?, updated_at=?, version=version+1 WHERE id=? AND version=?",
    )
    .bind(nextStatus, now, request.staffId, request.expectedVersion)
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, ACCESS_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "STAFF.ACCESS_CHANGED",
      resourceType: "staff_identity",
      resourceId: request.staffId,
      reason,
      before: { status: current.status },
      after: { status: nextStatus },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(deps.db, ACCESS_SCOPE, request.idempotencyKey, request.staffId, now),
  ]);
  return readStaffDetail(deps, request.staffId, request.requestId);
}
