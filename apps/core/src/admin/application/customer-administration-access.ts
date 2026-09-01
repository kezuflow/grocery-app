import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
} from "./staff-administration-access";

export type CustomerAdministrationDeps = {
  auth: AuthInstance;
  db: D1Database;
  accessContext?: ResolvedApplicationContext;
};

export type CustomerAdministrationAccess = {
  staffId: string;
  authUserId: string;
};

/**
 * Customer administration is a central, global-scope concern for the current release:
 * customer identity is global, so callers need the named capability plus a
 * global scope. Market/location-scoped principals receive FORBIDDEN.
 */
export async function resolveCustomerAdministrationAccess(
  deps: CustomerAdministrationDeps,
  request: AuthenticatedRequest,
  capability: "customers.read" | "customers.manage",
): Promise<RpcResult<CustomerAdministrationAccess>> {
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

export function customerListLimit(limit: number | undefined): number | "invalid" {
  return boundListLimit(limit);
}
