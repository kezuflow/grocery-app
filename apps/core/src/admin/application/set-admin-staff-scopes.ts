import type {
  AdminStaffDetail,
  AdminStaffScopesRequest,
  AppErrorCode,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  loadStaffRelations,
  readStaffDetail,
  resolveStaffAdministrationAccess,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const SCOPE = "admin.staff.scopes";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function validateScopeInput(scope: Scope): string | null {
  if (scope.kind === "global") return null;
  if (scope.kind === "market") {
    return scope.marketId && scope.marketId.trim() !== "" ? null : "market scope requires marketId";
  }
  if (scope.kind === "location") {
    return scope.locationId && scope.locationId.trim() !== ""
      ? null
      : "location scope requires locationId";
  }
  return "unknown scope kind";
}

/**
 * Atomically replace a staff member's scope assignments. Like role
 * replacement, every batch statement carries the caller's version predicate,
 * so a concurrent identity change makes the whole batch read back as
 * STALE_VERSION instead of partially applying.
 */
export async function setAdminStaffScopes(
  deps: StaffAdministrationDeps,
  request: AdminStaffScopesRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;

  const target = await deps.db
    .prepare("SELECT id, version FROM staff_identity WHERE id = ?")
    .bind(request.staffId)
    .first<{ id: string; version: number }>();
  if (!target) return failure("NOT_FOUND", "Staff identity not found", request.requestId);

  const uniqueScopes: Scope[] = [];
  const seen = new Set<string>();
  for (const scope of request.scopes) {
    const invalid = validateScopeInput(scope);
    if (invalid) return failure("VALIDATION_FAILED", invalid, request.requestId);
    const key = JSON.stringify(scope);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueScopes.push(scope);
    }
  }

  const before = (await loadStaffRelations(deps, [request.staffId])).get(request.staffId)!;

  const now = Date.now();
  const claim = await claimCommandIdempotency(deps.db, () => now, SCOPE, request.idempotencyKey, {
    staffId: request.staffId,
    scopes: uniqueScopes,
    expectedVersion: request.expectedVersion,
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
      return readStaffDetail(deps, request.staffId, request.requestId);
    }
    return failure("CONFLICT", "The scope command is still processing", request.requestId);
  }

  const guard = "EXISTS (SELECT 1 FROM staff_identity WHERE id = ? AND version = ?)";
  const guardBinds = [request.staffId, request.expectedVersion];
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`DELETE FROM staff_scope WHERE staff_id = ? AND ${guard}`)
      .bind(request.staffId, ...guardBinds),
    ...uniqueScopes.map((scope) =>
      deps.db
        .prepare(
          `INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id)
           SELECT ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(
          crypto.randomUUID(),
          request.staffId,
          scope.kind,
          scope.kind === "market" ? scope.marketId : null,
          scope.kind === "location" ? scope.locationId : null,
          ...guardBinds,
        ),
    ),
    
    auditEventStatement(
      deps.db,
      {
        actorUserId: access.value.authUserId,
        action: "STAFF.SCOPES_SET",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        before: { scopes: [...before.scopes].map((scope) => JSON.stringify(scope)).sort() },
        after: { scopes: uniqueScopes.map((scope) => JSON.stringify(scope)).sort() },
        correlationId: request.requestId,
        occurredAt: now,
      },
      { clause: guard, binds: guardBinds },
    ),
    deps.db
      .prepare(
        `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
         WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${guard}`,
      )
      .bind(request.staffId, now, SCOPE, request.idempotencyKey, ...guardBinds),
    deps.db
      .prepare(
        "UPDATE staff_identity SET updated_at = ?, version = version + 1 WHERE id = ? AND version = ?",
      )
      .bind(now, request.staffId, request.expectedVersion),
];

  await deps.db.batch(statements);
  const after = await deps.db
    .prepare("SELECT version FROM staff_identity WHERE id = ?")
    .bind(request.staffId)
    .first<{ version: number }>();
  if (after?.version !== request.expectedVersion + 1) {
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  }
  return readStaffDetail(deps, request.staffId, request.requestId);
}
