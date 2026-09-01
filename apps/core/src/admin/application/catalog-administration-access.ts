import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  hasOperationalScope,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
} from "./staff-administration-access";

export type CatalogAdministrationDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};

export type CatalogAdministrationAccess = {
  staffId: string;
  authUserId: string;
};

type CapabilityPair = "catalog.read" | "catalog.manage" | "inventory.read";

/**
 * Catalog identity administration is global. When an operational location is
 * supplied, Product projection reads and location-owned price/availability
 * commands may instead be authorized by global, parent-market, or exact
 * location scope. Inventory reads use the same operational scope rule.
 */
export async function resolveCatalogAdministrationAccess(
  deps: CatalogAdministrationDeps,
  request: AuthenticatedRequest,
  capability: CapabilityPair,
  operationalLocationId?: string,
): Promise<RpcResult<CatalogAdministrationAccess>> {
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
  const holdsCapability = context.value.capabilities.includes(capability);
  const globalScope = context.value.scopes.some((scope) => scope.kind === "global");
  let scopeAuthorized = globalScope;
  if (operationalLocationId !== undefined) {
    const marketRow = await deps.db
      .prepare("SELECT market_id FROM fulfillment_location WHERE id = ?")
      .bind(operationalLocationId)
      .first<{ market_id: string }>();
    scopeAuthorized = hasOperationalScope(
      context.value.scopes,
      operationalLocationId,
      marketRow?.market_id,
    );
  }
  if (!holdsCapability || !scopeAuthorized) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message:
          operationalLocationId === undefined
            ? `Global-scope ${capability} is required`
            : `${capability} is required for the selected operational location`,
        requestId: request.requestId,
      },
    };
  }
  const staffRecord = context.value.staffIdentity;
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

export { boundListLimit, decodeStaffCursor, encodeStaffCursor };
