import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  hasOperationalScope,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type OperationsAdministrationDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};
export type OperationsAdministrationAccess = { staffId: string; authUserId: string };

export type OperationsAdministrationCapability =
  | "procurement.read"
  | "procurement.manage"
  | "fulfillment.read"
  | "delivery.read"
  | "delivery.manage"
  | "fulfillment.manage";

export type OperationsAdministrationAccessOptions = {
  /** Return the same result for missing and out-of-scope locations on protected reads. */
  concealOutOfScopeLocation?: boolean;
};

/** Global fulfillment configuration requires both capability and global scope. */
export async function resolveGlobalFulfillmentAdministrationAccess(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest,
  capability: "fulfillment.read" | "fulfillment.manage",
): Promise<RpcResult<OperationsAdministrationAccess>> {
  const database = drizzle(deps.db, { schema: iamSchema });
  const context = await applicationContextForRequest(
    deps.auth,
    database,
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal)
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: request.requestId,
      },
    };
  if (
    !context.value.capabilities.includes(capability) ||
    !context.value.scopes.some((scope) => scope.kind === "global") ||
    !context.value.staffIdentity
  )
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `Global-scope ${capability} is required`,
        requestId: request.requestId,
      },
    };
  return {
    ok: true,
    value: {
      staffId: context.value.staffIdentity.id,
      authUserId: context.value.principal.userId,
    },
    requestId: request.requestId,
  };
}

/** Resolve the caller and verify the capability against the requested location's market scope. */
export async function resolveOperationsAdministrationAccess(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest,
  capability: OperationsAdministrationCapability,
  locationId: string,
  options: OperationsAdministrationAccessOptions = {},
): Promise<RpcResult<OperationsAdministrationAccess>> {
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
  if (options.concealOutOfScopeLocation && !context.value.capabilities.includes(capability)) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `${capability} is required`,
        requestId: request.requestId,
      },
    };
  }
  const location = await deps.db
    .prepare("SELECT market_id FROM fulfillment_location WHERE id = ? AND status='active'")
    .bind(locationId)
    .first<{ market_id: string }>();
  if (!location) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Active fulfillment location not found",
        requestId: request.requestId,
      },
    };
  }
  if (!hasOperationalScope(context.value.scopes, locationId, location.market_id)) {
    if (options.concealOutOfScopeLocation) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Active fulfillment location not found",
          requestId: request.requestId,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `${capability} and location scope are required`,
        requestId: request.requestId,
      },
    };
  }
  if (!context.value.capabilities.includes(capability)) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `${capability} and location scope are required`,
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
