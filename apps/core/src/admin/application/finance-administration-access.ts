import { drizzle } from "drizzle-orm/d1";
import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import {
  applicationContextForRequest,
  type ResolvedApplicationContext,
} from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";
import type { PaymentProviderRegistry } from "../../payments/ports/provider-registry";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
} from "./staff-administration-access";

export type FinanceAdministrationDeps = {
  auth: AuthInstance;
  db: D1Database;
  payments?: PaymentProviderRegistry;
  accessContext?: ResolvedApplicationContext;
};

export type FinanceAdministrationAccess = {
  staffId: string;
  authUserId: string;
  capabilities: ReadonlyArray<string>;
};

/**
 * Finance state is global for the current release: callers need the named capability plus a
 * global scope. Scoped principals receive FORBIDDEN.
 */
export async function resolveFinanceAdministrationAccess(
  deps: FinanceAdministrationDeps,
  request: AuthenticatedRequest,
  capability:
    | "orders.read"
    | "orders.manage"
    | "payments.read"
    | "payments.manage"
    | "refunds.manage"
    | "memberships.read"
    | "memberships.manage",
): Promise<RpcResult<FinanceAdministrationAccess>> {
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
    value: {
      staffId: staffRecord.id,
      authUserId: context.value.principal.userId,
      capabilities: context.value.capabilities,
    },
    requestId: request.requestId,
  };
}

export { boundListLimit, decodeStaffCursor, encodeStaffCursor };
