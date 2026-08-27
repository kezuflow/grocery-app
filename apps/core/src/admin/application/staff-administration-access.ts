import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
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
      error: { code: "FORBIDDEN", message: "Staff access is required", requestId: request.requestId },
    };
  }

  return {
    ok: true,
    value: { staffId: staffRecord.id, authUserId: context.value.principal.userId },
    requestId: request.requestId,
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
