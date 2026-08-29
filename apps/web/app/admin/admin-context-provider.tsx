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
  AdminContextView,
  AdminScopeOptionView,
  AdminSelectedScope,
  RpcResult,
} from "@freshmarkets/contracts";

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
    };

type AdminContextValue = {
  state: AdminContextState;
  retry: () => void;
  selectScope: (scope: AdminSelectedScope) => void;
};

const AdminContextContext = createContext<AdminContextValue | null>(null);

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

function assignedDefault(
  context: AdminContextView,
  options: ReadonlyArray<AdminScopeOptionView>,
): AdminSelectedScope | null {
  if (context.scopes.length !== 1) return null;
  const scope = context.scopes[0]!;
  if (scope.kind === "global") return { kind: "GLOBAL" };
  if (scope.kind === "market") return { kind: "MARKET", marketId: scope.marketId };
  const option = options.find(
    (candidate) => candidate.kind === "location" && candidate.locationId === scope.locationId,
  );
  return option?.kind === "location"
    ? { kind: "LOCATION", marketId: option.marketId, locationId: option.locationId }
    : null;
}

function sameScope(left: AdminSelectedScope, right: AdminSelectedScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Client boundary that fetches the Core-derived admin context and scope
 * options once per mount (with manual retry). It renders only what Core
 * returns and never computes capabilities or permissions itself.
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
      return { ...current, selectedScope: scope };
    });
  }, []);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const [contextResponse, scopesResponse] = await Promise.all([
          fetch("/api/admin/context"),
          fetch("/api/admin/scopes"),
        ]);
        const context = (await contextResponse.json()) as RpcResult<AdminContextView>;
        if (!context.ok) {
          if (!active) return;
          if (context.error.code === "UNAUTHENTICATED") {
            setState({ phase: "unauthenticated" });
          } else if (context.error.code === "FORBIDDEN") {
            setState({ phase: "forbidden" });
          } else {
            setState({
              phase: "error",
              message: context.error.message,
              requestId: context.error.requestId,
            });
          }
          return;
        }
        const scopes = (await scopesResponse.json()) as RpcResult<
          ReadonlyArray<AdminScopeOptionView>
        >;
        if (!active) return;
        if (!scopes.ok) {
          setState({
            phase: "error",
            message: scopes.error.message,
            requestId: scopes.error.requestId,
          });
          return;
        }
        const permitted = adminSelectableScopes(context.value, scopes.value);
        const storedRaw = sessionStorage.getItem(
          `freshmarkets.admin.scope:${context.value.staffId}`,
        );
        let stored: AdminSelectedScope | null = null;
        try {
          stored = storedRaw ? (JSON.parse(storedRaw) as AdminSelectedScope) : null;
        } catch {
          stored = null;
        }
        const selectedScope =
          stored && permitted.some((candidate) => sameScope(candidate, stored))
            ? stored
            : assignedDefault(context.value, scopes.value);
        setState({
          phase: "ready",
          context: context.value,
          scopes: scopes.value,
          selectedScope,
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
