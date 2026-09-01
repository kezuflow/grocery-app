"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AdminBootstrapView,
  AdminContextView,
  AdminOverviewView,
  AdminScopeOptionView,
  AdminSelectedScope,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  ADMIN_PRODUCT_PRICING_TARGET_COOKIE,
  resolveAdminProductPricingTarget,
  serializeAdminProductPricingTarget,
} from "@/lib/admin/product-pricing-target";

export type AdminContextState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "forbidden" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      context: AdminContextView;
      scopes: ReadonlyArray<AdminScopeOptionView>;
      selectedScope: AdminSelectedScope | null;
      overview: AdminOverviewView | null;
    };

type AdminContextValue = {
  state: AdminContextState;
  retry: () => void;
  selectScope: (scope: AdminSelectedScope) => void;
};

const AdminContextContext = createContext<AdminContextValue | null>(null);
const PREFERRED_SCOPE_KEY = "freshmarkets.admin.preferred-scope";

export function adminSelectableScopes(
  context: AdminContextView,
  options: ReadonlyArray<AdminScopeOptionView>,
): AdminSelectedScope[] {
  const selections: AdminSelectedScope[] = context.scopes.some((scope) => scope.kind === "global")
    ? [{ kind: "GLOBAL" }]
    : [];
  for (const option of options) {
    selections.push(
      option.kind === "market"
        ? { kind: "MARKET", marketId: option.marketId }
        : { kind: "LOCATION", marketId: option.marketId, locationId: option.locationId },
    );
  }
  return selections.filter(
    (scope, index) => selections.findIndex((candidate) => sameScope(candidate, scope)) === index,
  );
}

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

function storedPreferredScope(): AdminSelectedScope | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PREFERRED_SCOPE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || !("kind" in value)) return null;
    const record = value as Record<string, unknown>;
    if (record.kind === "GLOBAL") return { kind: "GLOBAL" };
    if (record.kind === "MARKET" && typeof record.marketId === "string") {
      return { kind: "MARKET", marketId: record.marketId };
    }
    if (
      record.kind === "LOCATION" &&
      typeof record.marketId === "string" &&
      typeof record.locationId === "string"
    ) {
      return { kind: "LOCATION", marketId: record.marketId, locationId: record.locationId };
    }
  } catch {
    // Invalid browser preference is ignored; Core remains scope authority.
  }
  return null;
}

function persistProductPricingTarget(
  selectedScope: AdminSelectedScope | null,
  scopes: ReadonlyArray<AdminScopeOptionView>,
) {
  const target = resolveAdminProductPricingTarget(selectedScope, scopes);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = target
    ? `${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=${serializeAdminProductPricingTarget(target)}; Path=/admin; SameSite=Lax${secure}`
    : `${ADMIN_PRODUCT_PRICING_TARGET_COOKIE}=; Max-Age=0; Path=/admin; SameSite=Lax${secure}`;
}

function bootstrapUrl(scope: AdminSelectedScope | null): string {
  const query = new URLSearchParams({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  if (scope) {
    query.set("scopeKind", scope.kind);
    if (scope.kind !== "GLOBAL") query.set("marketId", scope.marketId);
    if (scope.kind === "LOCATION") query.set("locationId", scope.locationId);
  }
  return `/api/admin/bootstrap?${query}`;
}

/**
 * Client boundary hydrated by one Core-owned bootstrap result. Browser scope
 * and Product pricing preferences are request hints; Core proves access again.
 */
export function AdminContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminContextState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const selectScope = useCallback((scope: AdminSelectedScope) => {
    setState((current) => {
      if (current.phase !== "ready") return current;
      const permitted = adminSelectableScopes(current.context, current.scopes);
      if (!permitted.some((candidate) => sameScope(candidate, scope))) return current;
      sessionStorage.setItem(
        `freshmarkets.admin.scope:${current.context.staffId}`,
        JSON.stringify(scope),
      );
      sessionStorage.setItem(PREFERRED_SCOPE_KEY, JSON.stringify(scope));
      persistProductPricingTarget(scope, current.scopes);
      return { ...current, selectedScope: scope, overview: null };
    });
  }, []);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const preferredScope = storedPreferredScope();
        const response = await fetch(bootstrapUrl(preferredScope));
        const bootstrap = (await response.json()) as RpcResult<AdminBootstrapView>;
        if (!bootstrap.ok) {
          if (!active) return;
          if (bootstrap.error.code === "UNAUTHENTICATED") {
            setState({ phase: "unauthenticated" });
          } else if (bootstrap.error.code === "FORBIDDEN") {
            setState({ phase: "forbidden" });
          } else {
            setState({
              phase: "error",
              message: bootstrap.error.message,
              requestId: bootstrap.error.requestId,
            });
          }
          return;
        }
        if (!active) return;
        const { context, scopes, selection, overview } = bootstrap.value;
        const selectedScope = selection.selectedScope;
        if (selectedScope) {
          sessionStorage.setItem(
            `freshmarkets.admin.scope:${context.staffId}`,
            JSON.stringify(selectedScope),
          );
          sessionStorage.setItem(PREFERRED_SCOPE_KEY, JSON.stringify(selectedScope));
        } else if (preferredScope) {
          sessionStorage.removeItem(PREFERRED_SCOPE_KEY);
        }
        persistProductPricingTarget(selectedScope, scopes);
        setState({
          phase: "ready",
          context,
          scopes,
          selectedScope,
          overview,
        });
      } catch {
        if (active) {
          setState({
            phase: "error",
            message: "Network error loading the admin context.",
            requestId: null,
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  const value = useMemo(() => ({ state, retry, selectScope }), [state, retry, selectScope]);
  return <AdminContextContext.Provider value={value}>{children}</AdminContextContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const value = useContext(AdminContextContext);
  if (!value) {
    throw new Error("useAdminContext must be used inside AdminContextProvider");
  }
  return value;
}
