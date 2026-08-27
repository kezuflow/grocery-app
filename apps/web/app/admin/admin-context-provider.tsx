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
import type { AdminContextView, AdminScopeOptionView, RpcResult } from "@freshmarkets/contracts";

export type AdminContextState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "forbidden" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      context: AdminContextView;
      scopes: ReadonlyArray<AdminScopeOptionView>;
    };

type AdminContextValue = {
  state: AdminContextState;
  retry: () => void;
};

const AdminContextContext = createContext<AdminContextValue | null>(null);

/**
 * Client boundary that fetches the Core-derived admin context and scope
 * options once per mount (with manual retry). It renders only what Core
 * returns and never computes capabilities or permissions itself.
 */
export function AdminContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminContextState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

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
        setState({
          phase: "ready",
          context: context.value,
          scopes: scopes.ok ? scopes.value : [],
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

  const value = useMemo(() => ({ state, retry }), [state, retry]);
  return <AdminContextContext.Provider value={value}>{children}</AdminContextContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const value = useContext(AdminContextContext);
  if (!value) {
    throw new Error("useAdminContext must be used inside AdminContextProvider");
  }
  return value;
}
