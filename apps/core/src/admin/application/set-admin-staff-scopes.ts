import type {
  AdminStaffDetail,
  AdminStaffScopesRequest,
  AppErrorCode,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { replayStaffCommand } from "./staff-command-replay";
import {
  beginStaffAdministrationWrite,
  requireStaffWrite,
} from "../../iam/infrastructure/staff-administration-write";
import { completeStaffCommandReceipt } from "../../iam/infrastructure/staff-command-receipt";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  loadStaffRelations,
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

async function validateActiveGeography(
  database: D1Database,
  scopes: ReadonlyArray<Scope>,
): Promise<string | null> {
  const marketIds = [
    ...new Set(scopes.flatMap((scope) => (scope.kind === "market" ? [scope.marketId] : []))),
  ];
  const locationIds = [
    ...new Set(scopes.flatMap((scope) => (scope.kind === "location" ? [scope.locationId] : []))),
  ];

  if (marketIds.length > 0) {
    const rows = await database
      .prepare(`SELECT id, status FROM market WHERE id IN (${marketIds.map(() => "?").join(",")})`)
      .bind(...marketIds)
      .all<{ id: string; status: string }>();
    const active = new Set(
      rows.results.filter((row) => row.status === "active").map((row) => row.id),
    );
    if (marketIds.some((id) => !active.has(id)))
      return "Every market scope must reference an active market";
  }

  if (locationIds.length > 0) {
    const rows = await database
      .prepare(
        `SELECT l.id, l.market_id AS marketId, l.status, m.status AS marketStatus
         FROM fulfillment_location l JOIN market m ON m.id=l.market_id
         WHERE l.id IN (${locationIds.map(() => "?").join(",")})`,
      )
      .bind(...locationIds)
      .all<{ id: string; marketId: string; status: string; marketStatus: string }>();
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    for (const id of locationIds) {
      const row = byId.get(id);
      if (!row || row.status !== "active" || row.marketStatus !== "active") {
        return "Every location scope must reference an active location in an active market";
      }
      if (marketIds.length > 0 && !marketIds.includes(row.marketId)) {
        return "Location scopes must belong to one of the assigned market scopes";
      }
    }
  }
  return null;
}

/** Replace scopes only while all referenced geography remains active. */
export async function setAdminStaffScopes(
  deps: StaffAdministrationDeps,
  request: AdminStaffScopesRequest,
): Promise<RpcResult<AdminStaffDetail>> {
  const access = await resolveStaffAdministrationAccess(deps, request, "staff.manage");
  if (!access.ok) return access;
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
  const hash = await requestHash({
    staffId: request.staffId,
    scopes: uniqueScopes,
    expectedVersion: request.expectedVersion,
  });
  const receipt = {
    scope: SCOPE,
    key: request.idempotencyKey,
    hash,
    staffId: request.staffId,
    requestId: request.requestId,
  };
  const prior = await replayStaffCommand(deps, receipt);
  if (prior) return prior;
  const target = await deps.db
    .prepare("SELECT version FROM staff_identity WHERE id=?")
    .bind(request.staffId)
    .first<{ version: number }>();
  if (!target) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  if (target.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Staff changed; refresh before retrying", request.requestId);
  const invalidGeography = await validateActiveGeography(deps.db, uniqueScopes);
  if (invalidGeography) return failure("VALIDATION_FAILED", invalidGeography, request.requestId);
  const before = (await loadStaffRelations(deps, [request.staffId])).get(request.staffId);
  if (!before) return failure("NOT_FOUND", "Staff identity not found", request.requestId);
  const marketIds = uniqueScopes.flatMap((scope) =>
    scope.kind === "market" ? [scope.marketId] : [],
  );
  const now = Date.now();
  const inserts = uniqueScopes.flatMap((scope) => {
    const guard =
      scope.kind === "global"
        ? "1=1"
        : scope.kind === "market"
          ? "EXISTS(SELECT 1 FROM market WHERE id=? AND status='active')"
          : "EXISTS(SELECT 1 FROM fulfillment_location l JOIN market m ON m.id=l.market_id WHERE l.id=? AND l.status='active' AND m.status='active' AND (?=0 OR l.market_id IN(SELECT value FROM json_each(?))))";
    const binds =
      scope.kind === "global"
        ? []
        : scope.kind === "market"
          ? [scope.marketId]
          : [scope.locationId, marketIds.length, JSON.stringify(marketIds)];
    return [
      deps.db
        .prepare(
          `INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id) SELECT ?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          crypto.randomUUID(),
          request.staffId,
          scope.kind,
          scope.kind === "market" ? scope.marketId : null,
          scope.kind === "location" ? scope.locationId : null,
          ...binds,
        ),
      requireStaffWrite(deps.db),
    ];
  });
  try {
    await deps.db.batch([
      ...beginStaffAdministrationWrite(deps.db, {
        ...receipt,
        ...access.value,
        resultType: "staff_change_snapshot",
        now,
      }),
      deps.db
        .prepare(
          "UPDATE staff_identity SET updated_at=?,version=version+1 WHERE id=? AND version=?",
        )
        .bind(now, request.staffId, request.expectedVersion),
      requireStaffWrite(deps.db),
      deps.db.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(request.staffId),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -35 WHERE EXISTS(SELECT 1 FROM staff_scope WHERE staff_id=?)",
        )
        .bind(request.staffId),
      ...inserts,
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "STAFF.SCOPES_SET",
        resourceType: "staff_identity",
        resourceId: request.staffId,
        before: { scopes: before.scopes.map((scope) => JSON.stringify(scope)).sort() },
        after: { scopes: uniqueScopes.map((scope) => JSON.stringify(scope)).sort() },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireStaffWrite(deps.db),
      ...completeStaffCommandReceipt(deps.db, { ...receipt, now }),
    ]);
  } catch {
    return (
      (await replayStaffCommand(deps, receipt)) ??
      failure(
        "CONFLICT",
        "Staff or geography changed; refresh and retry the same request",
        request.requestId,
      )
    );
  }
  return (
    (await replayStaffCommand(deps, receipt)) ??
    failure("INTERNAL_ERROR", "Saved staff result is unavailable", request.requestId)
  );
}
