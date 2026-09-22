"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminOverviewView, RpcResult } from "@freshmarkets/contracts";
import { useAdminContext } from "./admin-context-provider";

const OverviewContext = createContext<{
  result: RpcResult<AdminOverviewView> | null;
  refresh: () => void;
} | null>(null);

/** One scoped read supplies both the header and Overview, including refreshes. */
export function AdminOverviewProvider({ children }: { children: ReactNode }) {
  const { state } = useAdminContext();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    result: RpcResult<AdminOverviewView>;
  } | null>(null);
  const scope = state.phase === "ready" ? state.selectedScope : null;
  const scopeKey = scope ? JSON.stringify(scope) : null;
  const staffId = state.phase === "ready" ? state.context.staffId : null;
  const readKey = scope ? JSON.stringify([staffId, scope]) : null;
  const bootstrap = state.phase === "ready" ? state.overview : null;
  const timezone = useMemo(() => {
    if (state.phase !== "ready" || !scope) return "UTC";
    const option = state.scopes.find((candidate) =>
      scope.kind === "LOCATION"
        ? candidate.kind === "location" && candidate.locationId === scope.locationId
        : scope.kind === "MARKET" &&
          candidate.kind === "market" &&
          candidate.marketId === scope.marketId,
    );
    return option?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  }, [state, scope]);
  const bootstrapMatches = bootstrap && JSON.stringify(bootstrap.selectedScope) === scopeKey;
  useEffect(() => {
    if (!scope || !readKey || (bootstrapMatches && attempt === 0)) return;
    const controller = new AbortController();
    setLoaded(null);
    const query = new URLSearchParams({ scopeKind: scope.kind, timezone });
    if (scope.kind !== "GLOBAL") query.set("marketId", scope.marketId);
    if (scope.kind === "LOCATION") query.set("locationId", scope.locationId);
    const key = readKey;
    void fetch(`/api/admin/overview?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<RpcResult<AdminOverviewView>>)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ key, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            result: {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "We couldn’t load the operational overview.",
                requestId: "unavailable",
              },
            },
          });
      });
    return () => controller.abort();
  }, [scope, timezone, bootstrapMatches, attempt, readKey]);
  const result = !scope
    ? null
    : loaded?.key === readKey
      ? loaded.result
      : attempt === 0 && bootstrapMatches && bootstrap
        ? { ok: true as const, value: bootstrap, requestId: "bootstrap" }
        : null;
  return (
    <OverviewContext.Provider value={{ result, refresh: () => setAttempt((value) => value + 1) }}>
      {children}
    </OverviewContext.Provider>
  );
}

export function useAdminOverview() {
  const context = useContext(OverviewContext);
  if (!context) throw new Error("AdminOverviewProvider is required");
  return context;
}
