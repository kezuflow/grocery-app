import type {
  AdminBootstrapRequest,
  AdminBootstrapView,
  AdminContextView,
  AdminScopeOptionView,
  AdminSelectedScope,
  RpcResult,
  Scope,
} from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import { applicationContextForRequest } from "../../auth/authorization";
import { iamSchema } from "../../iam/schema";
import { getAdminOverview } from "./admin-overview";
import { getAdminContext, type AdminContextDeps } from "./get-admin-context";
import { listAdminScopes } from "./list-admin-scopes";

function sameScope(left: AdminSelectedScope, right: AdminSelectedScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "GLOBAL") return true;
  if (left.kind === "MARKET" && right.kind === "MARKET") return left.marketId === right.marketId;
  return (
    left.kind === "LOCATION" &&
    right.kind === "LOCATION" &&
    left.marketId === right.marketId &&
    left.locationId === right.locationId
  );
}

function selectableScopes(
  assigned: ReadonlyArray<Scope>,
  options: ReadonlyArray<AdminScopeOptionView>,
): ReadonlyArray<AdminSelectedScope> {
  const result: AdminSelectedScope[] = assigned.some((scope) => scope.kind === "global")
    ? [{ kind: "GLOBAL" }]
    : [];
  for (const option of options) {
    result.push(
      option.kind === "market"
        ? { kind: "MARKET", marketId: option.marketId }
        : { kind: "LOCATION", marketId: option.marketId, locationId: option.locationId },
    );
  }
  return result.filter(
    (scope, index) => result.findIndex((candidate) => sameScope(candidate, scope)) === index,
  );
}

function singleAssignedScope(
  context: AdminContextView,
  options: ReadonlyArray<AdminScopeOptionView>,
): AdminSelectedScope | null {
  if (context.scopes.length !== 1) return null;
  const assigned = context.scopes[0]!;
  if (assigned.kind === "global") return { kind: "GLOBAL" };
  if (assigned.kind === "market") return { kind: "MARKET", marketId: assigned.marketId };
  const location = options.find(
    (option) => option.kind === "location" && option.locationId === assigned.locationId,
  );
  return location?.kind === "location"
    ? { kind: "LOCATION", marketId: location.marketId, locationId: location.locationId }
    : null;
}

function selectedTimezone(
  selectedScope: AdminSelectedScope,
  options: ReadonlyArray<AdminScopeOptionView>,
  requestedTimezone: string,
): string {
  if (selectedScope.kind === "GLOBAL") return requestedTimezone;
  const option = options.find((candidate) =>
    selectedScope.kind === "MARKET"
      ? candidate.kind === "market" && candidate.marketId === selectedScope.marketId
      : candidate.kind === "location" && candidate.locationId === selectedScope.locationId,
  );
  return option?.timezone ?? requestedTimezone;
}

/**
 * Core-owned first-render composition. Phase 3 intentionally composes the
 * established authorized reads; Phase 4 replaces their duplicate IAM work
 * with one immutable request-scoped access context.
 */
export async function getAdminBootstrap(
  deps: AdminContextDeps,
  request: AdminBootstrapRequest,
): Promise<RpcResult<AdminBootstrapView>> {
  const access = await applicationContextForRequest(
    deps.auth,
    drizzle(deps.db, { schema: iamSchema }),
    request,
    deps.accessContext,
  );
  if (!access.ok) return access;
  const requestDeps = { ...deps, accessContext: access.value };
  const [context, scopes] = await Promise.all([
    getAdminContext(requestDeps, request),
    listAdminScopes(requestDeps, request),
  ]);
  if (!context.ok) return context;
  if (!scopes.ok) return scopes;

  const permitted = selectableScopes(context.value.scopes, scopes.value);
  const requestedScopeAccepted = request.selectedScope
    ? permitted.some((candidate) => sameScope(candidate, request.selectedScope!))
    : null;
  const selectedScope =
    requestedScopeAccepted === true
      ? request.selectedScope!
      : singleAssignedScope(context.value, scopes.value);
  const source =
    requestedScopeAccepted === true
      ? "REQUESTED"
      : selectedScope
        ? "SINGLE_ASSIGNMENT"
        : "SELECTION_REQUIRED";
  const timezone = selectedScope
    ? selectedTimezone(selectedScope, scopes.value, request.timezone)
    : null;
  const overview =
    selectedScope && timezone
      ? await getAdminOverview(requestDeps, { ...request, selectedScope, timezone })
      : null;
  if (overview && !overview.ok) return overview;

  return {
    ok: true,
    value: {
      context: context.value,
      scopes: scopes.value,
      selection: { selectedScope, source, requestedScopeAccepted, timezone },
      overview: overview?.value ?? null,
    },
    requestId: request.requestId,
  };
}
