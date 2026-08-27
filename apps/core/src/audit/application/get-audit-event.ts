import type {
  AdminAuditDetailRequest,
  AdminAuditEventView,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  auditScopePredicate,
  parseSanitizedJson,
  resolveAdminAuditAccess,
  type AdminAuditDeps,
} from "./list-audit-events";

/**
 * Scoped, sanitized Audit detail. `metadata`/`before`/`after` are parsed and
 * recursively redacted — raw JSON strings and raw rows never reach the DTO.
 */
export async function getAdminAuditEvent(
  deps: AdminAuditDeps,
  request: AdminAuditDetailRequest,
): Promise<RpcResult<AdminAuditEventView>> {
  const access = await resolveAdminAuditAccess(deps, request);
  if (!access.ok) return access;

  const scope = auditScopePredicate(access.value);
  const row = await deps.db
    .prepare(
      `SELECT id, occurred_at AS occurredAt,
              actor_user_id AS actorId,
              action,
              aggregate_type AS resourceType,
              aggregate_id AS resourceId,
              market_id, location_id, reason, correlation_id,
              details_json AS metadataJson,
              before_json AS beforeJson,
              after_json AS afterJson
       FROM audit_event
       WHERE id = ? AND ${scope.clause}`,
    )
    .bind(request.auditEventId, ...scope.params)
    .first<{
      id: string;
      occurredAt: number;
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string;
      market_id: string | null;
      location_id: string | null;
      reason: string | null;
      correlation_id: string | null;
      metadataJson: string;
      beforeJson: string | null;
      afterJson: string | null;
    }>();

  if (!row) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Audit event not found in scope",
        requestId: request.requestId,
      },
    };
  }

  const metadata = parseSanitizedJson(row.metadataJson, {
    requestId: request.requestId,
    field: "details_json",
  });
  const before = parseSanitizedJson(row.beforeJson, {
    requestId: request.requestId,
    field: "before_json",
  });
  const after = parseSanitizedJson(row.afterJson, {
    requestId: request.requestId,
    field: "after_json",
  });

  return {
    ok: true,
    value: {
      auditEventId: row.id,
      occurredAt: new Date(row.occurredAt).toISOString(),
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      marketId: row.market_id,
      locationId: row.location_id,
      reason: row.reason,
      correlationId: row.correlation_id,
      // details_json is NOT NULL historically; a non-object still sanitizes
      // to an empty object with a logged warning.
      metadata: metadata.value ?? {},
      before: before.value,
      after: after.value,
    },
    requestId: request.requestId,
  };
}
