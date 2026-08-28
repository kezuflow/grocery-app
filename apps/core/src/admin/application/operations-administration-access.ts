import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import { applicationContext, hasOperationalScope } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type OperationsAdministrationDeps = { auth: AuthInstance; db: D1Database };
export type OperationsAdministrationAccess = { staffId: string; authUserId: string };

export type OperationsAdministrationCapability =
  | "procurement.read"
  | "receiving.manage"
  | "fulfillment.read"
  | "delivery.read"
  | "fulfillment.manage";

/** Resolve the caller and verify the capability against the requested location's market scope. */
export async function resolveOperationsAdministrationAccess(
  deps: OperationsAdministrationDeps,
  request: AuthenticatedRequest,
  capability: OperationsAdministrationCapability,
  locationId: string,
): Promise<RpcResult<OperationsAdministrationAccess>> {
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
  if (
    !context.value.capabilities.includes(capability) ||
    !hasOperationalScope(context.value.scopes, locationId, location.market_id)
  ) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `${capability} and location scope are required`,
        requestId: request.requestId,
      },
    };
  }
  const staff = await database
    .select({ id: iamSchema.staffIdentity.id })
    .from(iamSchema.staffIdentity)
    .where(eq(iamSchema.staffIdentity.authUserId, context.value.principal.userId))
    .limit(1);
  if (!staff[0]) {
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
    value: { staffId: staff[0].id, authUserId: context.value.principal.userId },
    requestId: request.requestId,
  };
}
