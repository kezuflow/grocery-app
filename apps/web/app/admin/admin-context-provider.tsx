"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { toast } from "sonner";
import { hasAdminScopeCommandLock } from "@/components/admin/admin-scope-command-lock";
import {
  ADMIN_PRODUCT_SCOPE_TARGET_COOKIE,
  resolveAdminProductScopeTarget,
  serializeAdminProductScopeTarget,
} from "@/lib/admin/product-scope-target";

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
  registerScopeGuard: (guard: () => ScopeGuardState) => () => void;
};

type ScopeGuardState = { dirty: boolean; locked: boolean; discard?: () => void };

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
    if (option.kind === "location") {
      selections.push({
        kind: "LOCATION",
        marketId: option.marketId,
        locationId: option.locationId,
      });
    }
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

function persistProductScopeTarget(selectedScope: AdminSelectedScope | null) {
  const target = resolveAdminProductScopeTarget(selectedScope);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = target
    ? `${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=${serializeAdminProductScopeTarget(target)}; Path=/admin; SameSite=Lax${secure}`
    : `${ADMIN_PRODUCT_SCOPE_TARGET_COOKIE}=; Max-Age=0; Path=/admin; SameSite=Lax${secure}`;
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
 * and Product scope preferences are request hints; Core proves access again.
 */
export function AdminContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminContextState>({ phase: "loading" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const scopeGuards = useRef(new Set<() => ScopeGuardState>());
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const registerScopeGuard = useCallback((guard: () => ScopeGuardState) => {
    scopeGuards.current.add(guard);
    return () => scopeGuards.current.delete(guard);
  }, []);
  const selectScope = useCallback((scope: AdminSelectedScope) => {
    const current = stateRef.current;
    if (
      current.phase !== "ready" ||
      (current.selectedScope && sameScope(current.selectedScope, scope))
    )
      return;
    const permitted = adminSelectableScopes(current.context, current.scopes);
    if (!permitted.some((candidate) => sameScope(candidate, scope))) return;
    const guards = [...scopeGuards.current].map((guard) => guard());
    if (hasAdminScopeCommandLock() || guards.some((guard) => guard.locked)) {
      toast.error("Finish or recover the current request before changing scope.");
      return;
    }
    if (
      guards.some((guard) => guard.dirty) &&
      !window.confirm("Discard unsaved changes and change the Admin scope?")
    )
      return;
    for (const guard of guards) if (guard.dirty) guard.discard?.();
    sessionStorage.setItem(
      `freshmarkets.admin.scope:${current.context.staffId}`,
      JSON.stringify(scope),
    );
    sessionStorage.setItem(PREFERRED_SCOPE_KEY, JSON.stringify(scope));
    persistProductScopeTarget(scope);
    const url = new URL(window.location.href);
    if (url.searchParams.has("cursor") || url.searchParams.has("cursorHistory")) {
      url.searchParams.delete("cursor");
      url.searchParams.delete("cursorHistory");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setState((latest) =>
      latest.phase === "ready" ? { ...latest, selectedScope: scope, overview: null } : latest,
    );
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
        persistProductScopeTarget(selectedScope);
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

  const value = useMemo(
    () => ({ state, retry, selectScope, registerScopeGuard }),
    [state, retry, selectScope, registerScopeGuard],
  );
  return <AdminContextContext.Provider value={value}>{children}</AdminContextContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const value = useContext(AdminContextContext);
  if (!value) {
    throw new Error("useAdminContext must be used inside AdminContextProvider");
  }
  return value;
}

/** A form may declare unsaved edits or a separate pending/unknown operation. */
export function useAdminScopeGuard(dirty: boolean, locked: boolean, discard?: () => void): void {
  const registerScopeGuard = useContext(AdminContextContext)?.registerScopeGuard;
  const latest = useRef({ dirty, locked, discard });
  latest.current = { dirty, locked, discard };
  useEffect(() => registerScopeGuard?.(() => latest.current), [registerScopeGuard]);
}
