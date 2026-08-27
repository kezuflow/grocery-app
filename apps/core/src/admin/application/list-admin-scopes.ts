import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  AdminScopeOptionView,
  AuthenticatedRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import { applicationContext } from "../../auth/authorization";
import type { AuthInstance } from "../../auth/service";
import { iamSchema } from "../../iam/schema";
import type { AdminContextDeps } from "./get-admin-context";

/**
 * Permitted scope-selector options for the active Staff principal: only the
 * active markets/locations reachable by global, market, or location
 * assignment. Polygon geometry and location-ranking rules are never exposed.
 */
export async function listAdminScopes(
  deps: AdminContextDeps,
  request: AuthenticatedRequest,
): Promise<RpcResult<ReadonlyArray<AdminScopeOptionView>>> {
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

  const staff = await database
    .select({ id: iamSchema.staffIdentity.id, status: iamSchema.staffIdentity.status })
    .from(iamSchema.staffIdentity)
    .where(
      eq(iamSchema.staffIdentity.authUserId, context.value.principal.userId),
    )
    .limit(1);
  const staffRecord = staff[0];
  if (!staffRecord || staffRecord.status !== "active") {
    return {
      ok: false,
      error: { code: "FORBIDDEN", message: "Staff access is required", requestId: request.requestId },
    };
  }

  const scopes = context.value.scopes;
  const isGlobal = scopes.some((scope) => scope.kind === "global");
  const assignedMarketIds = new Set(
    scopes.filter((scope) => scope.kind === "market").map((scope) => scope.marketId),
  );
  const assignedLocationIds = new Set(
    scopes.filter((scope) => scope.kind === "location").map((scope) => scope.locationId),
  );

  const markets = await deps.db
    .prepare(
      "SELECT id, code, name, currency, timezone FROM market WHERE status = 'active' ORDER BY code",
    )
    .all<{ id: string; code: string; name: string; currency: string; timezone: string }>();
  const locations = await deps.db
    .prepare(
      "SELECT id, market_id, code, name FROM fulfillment_location WHERE status = 'active' ORDER BY code",
    )
    .all<{ id: string; market_id: string; code: string; name: string }>();

  const marketById = new Map(markets.results.map((market) => [market.id, market]));
  const options: AdminScopeOptionView[] = [];
  for (const market of markets.results) {
    const reachable =
      isGlobal ||
      assignedMarketIds.has(market.id) ||
      [...assignedLocationIds].some((locationId) =>
        locations.results.some(
          (location) => location.id === locationId && location.market_id === market.id,
        ),
      );
    if (reachable) {
      options.push({
        kind: "market",
        marketId: market.id,
        marketCode: market.code,
        marketName: market.name,
        currency: market.currency,
        timezone: market.timezone,
      });
    }
  }
  for (const location of locations.results) {
    const market = marketById.get(location.market_id);
    if (!market) continue;
    const reachable =
      isGlobal || assignedMarketIds.has(location.market_id) || assignedLocationIds.has(location.id);
    if (reachable) {
      options.push({
        kind: "location",
        marketId: market.id,
        marketCode: market.code,
        locationId: location.id,
        locationCode: location.code,
        locationName: location.name,
        currency: market.currency,
        timezone: market.timezone,
      });
    }
  }

  return { ok: true, value: options, requestId: request.requestId };
}
