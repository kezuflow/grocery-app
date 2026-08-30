import { drizzle } from "drizzle-orm/d1";
import type {
  AdminSelectedScope,
  AuthenticatedRequest,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { applicationContext, hasOperationalScope } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";

export type AnalyticsDeps = { auth: AuthInstance; db: D1Database };

export type AnalyticsAccess = { scope: Scope; now: number };

/** Resolves Analytics capability and an explicitly permitted reporting scope before source reads. */
export async function resolveAnalyticsAccess(
  deps: AnalyticsDeps,
  request: AuthenticatedRequest,
  requestedScope?: AdminSelectedScope,
): Promise<RpcResult<AnalyticsAccess>> {
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
  if (!context.value.capabilities.includes("analytics.read")) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "analytics.read is required",
        requestId: request.requestId,
      },
    };
  }

  if (!requestedScope && context.value.scopes.length > 1) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Select an Admin scope",
        requestId: request.requestId,
      },
    };
  }
  const scope: Scope | undefined = requestedScope
    ? requestedScope.kind === "GLOBAL"
      ? { kind: "global" }
      : requestedScope.kind === "MARKET"
        ? { kind: "market", marketId: requestedScope.marketId }
        : { kind: "location", locationId: requestedScope.locationId }
    : context.value.scopes[0];
  if (!scope) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Analytics scope is required",
        requestId: request.requestId,
      },
    };
  }
  if (scope.kind === "global") {
    if (!context.value.scopes.some((candidate) => candidate.kind === "global")) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Global Analytics scope is required",
          requestId: request.requestId,
        },
      };
    }
  } else if (scope.kind === "market") {
    const market = await deps.db
      .prepare("SELECT id FROM market WHERE id=? AND status='active'")
      .bind(scope.marketId)
      .first<{ id: string }>();
    if (!market) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Active market not found",
          requestId: request.requestId,
        },
      };
    }
    if (
      !context.value.scopes.some(
        (candidate) =>
          candidate.kind === "global" ||
          (candidate.kind === "market" && candidate.marketId === scope.marketId),
      )
    ) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Analytics market scope is required",
          requestId: request.requestId,
        },
      };
    }
  } else {
    const location = await deps.db
      .prepare(
        "SELECT market_id AS marketId FROM fulfillment_location WHERE id=? AND status='active'",
      )
      .bind(scope.locationId)
      .first<{ marketId: string }>();
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
    if (requestedScope?.kind === "LOCATION" && requestedScope.marketId !== location.marketId) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Selected location does not belong to the selected market",
          requestId: request.requestId,
        },
      };
    }
    if (!hasOperationalScope(context.value.scopes, scope.locationId, location.marketId)) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Analytics location scope is required",
          requestId: request.requestId,
        },
      };
    }
  }
  return { ok: true, value: { scope, now: Date.now() }, requestId: request.requestId };
}
