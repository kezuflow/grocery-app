import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  AdminStaffDetail,
  AuthenticatedRequest,
  Capability,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { isAdminCapability } from "@freshmarkets/contracts";
import { applicationContext } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type StaffAdministrationDeps = {
  auth: AuthInstance;
  db: D1Database;
};

export type StaffAdministrationAccess = {
  staffId: string;
  authUserId: string;
};

/**
 * Staff administration is a central, global-scope concern: the caller must
 * hold the named capability AND a global scope. Market/location-scoped
 * principals cannot administer staff regardless of capability rows.
 */
export async function resolveStaffAdministrationAccess(
  deps: StaffAdministrationDeps,
  request: AuthenticatedRequest,
  capability: "staff.read" | "staff.manage",
): Promise<RpcResult<StaffAdministrationAccess>> {
  const database = drizzle(deps.db, { schema: iamSchema });
  const context = await applicationContext(deps.auth, database, request);
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
  if (
    !context.value.capabilities.includes(capability) ||
    !context.value.scopes.some((scope) => scope.kind === "global")
  ) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `Global-scope ${capability} is required`,
        requestId: request.requestId,
      },
    };
  }

  const staff = await database
    .select({ id: iamSchema.staffIdentity.id })
    .from(iamSchema.staffIdentity)
    .where(eq(iamSchema.staffIdentity.authUserId, context.value.principal.userId))
    .limit(1);
  const staffRecord = staff[0];
  if (!staffRecord) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Staff access is required",
        requestId: request.requestId,
      },
    };
  }

  return {
    ok: true,
    value: { staffId: staffRecord.id, authUserId: context.value.principal.userId },
    requestId: request.requestId,
  };
}

type StaffRelationRow = {
  scope_kind: string;
  market_id: string | null;
  location_id: string | null;
};

function toScope(row: StaffRelationRow): Scope | null {
  if (row.scope_kind === "global") return { kind: "global" };
  if (row.scope_kind === "market" && row.market_id)
    return { kind: "market", marketId: row.market_id };
  if (row.scope_kind === "location" && row.location_id) {
    return { kind: "location", locationId: row.location_id };
  }
  return null;
}

export type StaffRelations = {
  roleCodes: Set<string>;
  capabilityCodes: Set<Capability>;
  scopes: Scope[];
};

/** Aggregate roles, canonical capabilities, and scopes for the given staff ids. */
export async function loadStaffRelations(
  deps: StaffAdministrationDeps,
  staffIds: ReadonlyArray<string>,
): Promise<Map<string, StaffRelations>> {
  const relations = new Map<string, StaffRelations>();
  if (staffIds.length === 0) return relations;
  const placeholders = staffIds.map(() => "?").join(",");
  const binds = [...staffIds];

  const roles = await deps.db
    .prepare(
      `SELECT sr.staff_id AS staffId, r.code AS code FROM staff_role sr
       JOIN role r ON r.id = sr.role_id WHERE sr.staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string; code: string }>();
  const capabilities = await deps.db
    .prepare(
      `SELECT sr.staff_id AS staffId, p.code AS code FROM staff_role sr
       JOIN role_permission rp ON rp.role_id = sr.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE sr.staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string; code: string }>();
  const scopes = await deps.db
    .prepare(
      `SELECT staff_id AS staffId, scope_kind, market_id, location_id FROM staff_scope
       WHERE staff_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<{ staffId: string } & StaffRelationRow>();

  for (const staffId of staffIds) {
    relations.set(staffId, { roleCodes: new Set(), capabilityCodes: new Set(), scopes: [] });
  }
  for (const row of roles.results) relations.get(row.staffId)?.roleCodes.add(row.code);
  for (const row of capabilities.results) {
    if (isAdminCapability(row.code)) relations.get(row.staffId)?.capabilityCodes.add(row.code);
  }
  for (const row of scopes.results) {
    const scope = toScope(row);
    if (scope) relations.get(row.staffId)?.scopes.push(scope);
  }
  return relations;
}

/** Authoritative staff detail read used by command results and the detail query. */
export async function readStaffDetail(
  deps: StaffAdministrationDeps,
  staffId: string,
  requestId: string,
): Promise<RpcResult<AdminStaffDetail>> {
  const row = await deps.db
    .prepare(
      `SELECT s.id AS staffId, s.auth_user_id AS authUserId, s.display_name AS displayName,
              u.email AS email, s.status, s.version, s.created_at AS createdAt
       FROM staff_identity s JOIN user u ON u.id = s.auth_user_id
       WHERE s.id = ?`,
    )
    .bind(staffId)
    .first<{
      staffId: string;
      authUserId: string;
      displayName: string;
      email: string;
      status: "active" | "suspended";
      version: number;
      createdAt: number;
    }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Staff identity not found", requestId },
    };
  }
  const relations = (await loadStaffRelations(deps, [row.staffId])).get(row.staffId)!;
  return {
    ok: true,
    value: {
      staffId: row.staffId,
      authUserId: row.authUserId,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      roleCodes: [...relations.roleCodes].sort(),
      capabilityCodes: [...relations.capabilityCodes].sort(),
      scopes: relations.scopes,
      version: row.version,
      createdAt: new Date(row.createdAt).toISOString(),
    },
    requestId,
  };
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

export type StaffKeysetCursor = { createdAt: number; id: string };

export function encodeStaffCursor(cursor: StaffKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeStaffCursor(cursor: string): StaffKeysetCursor | null {
  try {
    const parsed = JSON.parse(fromBase64Url(cursor)) as { createdAt?: unknown; id?: unknown };
    if (
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt) &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function boundListLimit(limit: number | undefined): number | "invalid" {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return "invalid";
  return limit;
}
