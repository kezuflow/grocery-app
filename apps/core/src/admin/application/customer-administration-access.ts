import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import { applicationContext } from "../../auth/authorization";
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
};

export type CustomerAdministrationAccess = {
  staffId: string;
  authUserId: string;
};

/**
 * Customer administration is a central, global-scope concern for MVP:
 * customer identity is global, so callers need the named capability plus a
 * global scope. Market/location-scoped principals receive FORBIDDEN.
 */
export async function resolveCustomerAdministrationAccess(
  deps: CustomerAdministrationDeps,
  request: AuthenticatedRequest,
  capability: "customers.read" | "customers.manage",
): Promise<RpcResult<CustomerAdministrationAccess>> {
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

export {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
};

export function customerListLimit(limit: number | undefined): number | "invalid" {
  return boundListLimit(limit);
}
