import { drizzle } from "drizzle-orm/d1";
import type {
  AdminAuditEventListItem,
  AdminAuditEventPage,
  AdminAuditListRequest,
  AuthenticatedRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";
import { log } from "../../observability";

export type AdminAuditDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};

export type AdminAuditAccess = {
  scopes: { global: boolean; marketIds: string[]; locationIds: string[] };
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Resolve the calling Staff principal for an Audit read: an active staff
 * identity holding `audit.read` with its assigned market/location scopes.
 * Every Audit query derives authorization here — never from Web input.
 */
export async function resolveAdminAuditAccess(
  deps: AdminAuditDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<AdminAuditAccess>> {
  const database = drizzle(deps.db, { schema: iamSchema });
  const context = await applicationContextForRequest(
    deps.auth,
    database,
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: request.requestId,
      },
    };
  }

  const staffRecord = context.value.staffIdentity;
  if (!staffRecord || staffRecord.status !== "active") {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Staff access is required",
        requestId: request.requestId,
      },
    };
  }
  if (!context.value.capabilities.includes("audit.read")) {
    return {
      ok: false,
      error: { code: "FORBIDDEN", message: "audit.read is required", requestId: request.requestId },
    };
  }

  return {
    ok: true,
    value: {
      scopes: {
        global: context.value.scopes.some((scope) => scope.kind === "global"),
        marketIds: context.value.scopes
          .filter((scope) => scope.kind === "market")
          .map((scope) => scope.marketId),
        locationIds: context.value.scopes
          .filter((scope) => scope.kind === "location")
          .map((scope) => scope.locationId),
      },
    },
    requestId: request.requestId,
  };
}

/** SQL predicate restricting Audit rows to the principal's resource scope. */
export function auditScopePredicate(access: AdminAuditAccess): {
  clause: string;
  params: unknown[];
} {
  if (access.scopes.global) return { clause: "1=1", params: [] };
  const alternatives: string[] = [];
  const params: unknown[] = [];
  for (const locationId of access.scopes.locationIds) {
    alternatives.push("location_id = ?");
    params.push(locationId);
  }
  for (const marketId of access.scopes.marketIds) {
    alternatives.push(
      "(market_id = ? OR location_id IN (SELECT id FROM fulfillment_location WHERE market_id = ?))",
    );
    params.push(marketId, marketId);
  }
  // Without any scope the principal sees nothing; unscoped (global) Audit rows
  // are reserved for global-scoped principals.
  if (alternatives.length === 0) return { clause: "1=0", params: [] };
  return { clause: `(${alternatives.join(" OR ")})`, params };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeCursor(cursor: string): { occurredAt: number; id: string } | null {
  try {
    const parsed = JSON.parse(fromBase64Url(cursor)) as {
      occurredAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.occurredAt === "number" &&
      Number.isFinite(parsed.occurredAt) &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      return { occurredAt: parsed.occurredAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toListItem(row: {
  id: string;
  occurred_at: number;
  actor_user_id: string | null;
  action: string;
  aggregate_type: string;
  aggregate_id: string;
  market_id: string | null;
  location_id: string | null;
  reason: string | null;
  correlation_id: string | null;
}): AdminAuditEventListItem {
  return {
    auditEventId: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorId: row.actor_user_id,
    action: row.action,
    resourceType: row.aggregate_type,
    resourceId: row.aggregate_id,
    marketId: row.market_id,
    locationId: row.location_id,
    reason: row.reason,
    correlationId: row.correlation_id,
  };
}

/** Bounded, scope-filtered, cursor-paginated Audit listing for admin UIs. */
export async function listAdminAuditEvents(
  deps: AdminAuditDeps,
  request: AdminAuditListRequest,
): Promise<RpcResult<AdminAuditEventPage>> {
  const access = await resolveAdminAuditAccess(deps, request);
  if (!access.ok) return access;

  const limit = request.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
        requestId: request.requestId,
      },
    };
  }
  let cursor: { occurredAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (request.from !== undefined) {
    fromMs = parseInstant(request.from);
    if (fromMs === null) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "from must be an ISO 8601 instant",
          requestId: request.requestId,
        },
      };
    }
  }
  if (request.to !== undefined) {
    toMs = parseInstant(request.to);
    if (toMs === null) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "to must be an ISO 8601 instant",
          requestId: request.requestId,
        },
      };
    }
  }

  const scope = auditScopePredicate(access.value);
  const clauses: string[] = [scope.clause];
  const params: unknown[] = [...scope.params];
  if (request.action !== undefined) {
    clauses.push("action = ?");
    params.push(request.action);
  }
  if (request.resourceType !== undefined) {
    clauses.push("aggregate_type = ?");
    params.push(request.resourceType);
  }
  if (request.actorId !== undefined) {
    clauses.push("actor_user_id = ?");
    params.push(request.actorId);
  }
  if (request.marketId !== undefined) {
    clauses.push("market_id = ?");
    params.push(request.marketId);
  }
  if (request.locationId !== undefined) {
    clauses.push("location_id = ?");
    params.push(request.locationId);
  }
  if (fromMs !== null) {
    clauses.push("occurred_at >= ?");
    params.push(fromMs);
  }
  if (toMs !== null) {
    clauses.push("occurred_at <= ?");
    params.push(toMs);
  }
  if (cursor) {
    clauses.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }

  const statement = deps.db
    .prepare(
      `SELECT id, occurred_at, actor_user_id, action, aggregate_type, aggregate_id,
              market_id, location_id, reason, correlation_id
       FROM audit_event
       WHERE ${clauses.join(" AND ")}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(...params, limit + 1);
  const rows = await statement.all<{
    id: string;
    occurred_at: number;
    actor_user_id: string | null;
    action: string;
    aggregate_type: string;
    aggregate_id: string;
    market_id: string | null;
    location_id: string | null;
    reason: string | null;
    correlation_id: string | null;
  }>();

  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit).map(toListItem);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? toBase64Url(
          JSON.stringify({
            occurredAt: new Date(last.occurredAt).getTime(),
            id: last.auditEventId,
          }),
        )
      : null;

  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** Parse stored historical JSON into a sanitized object, or fail safe. */
export function parseSanitizedJson(
  raw: string | null,
  context: { requestId: string; field: string },
): { value: Record<string, unknown> | null } {
  if (raw === null) return { value: null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { value: redactValue(parsed) as Record<string, unknown> };
    }
    log("warn", "audit.sanitization", {
      requestId: context.requestId,
      field: context.field,
      reason: "not_an_object",
    });
    return { value: {} };
  } catch {
    log("warn", "audit.sanitization", {
      requestId: context.requestId,
      field: context.field,
      reason: "invalid_json",
    });
    return { value: {} };
  }
}

const REDACTED_KEYS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "secret",
  "cookie",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "providerpayload",
]);

/** Recursively replace sensitive values with "[REDACTED]", case-insensitively. */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(inner);
    }
    return result;
  }
  return value;
}
