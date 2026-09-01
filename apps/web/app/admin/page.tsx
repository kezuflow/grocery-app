"use client";

import type { AdminOverviewView, AdminSelectedScope, RpcResult } from "@freshmarkets/contracts";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { useAdminContext } from "./admin-context-provider";

const AdminOverviewViewContent = lazy(() =>
  import("@/components/admin/admin-overview-view").then((module) => ({
    default: module.AdminOverviewViewContent,
  })),
);

function scopeQuery(scope: AdminSelectedScope, timezone: string) {
  const query = new URLSearchParams({ scopeKind: scope.kind, timezone });
  if (scope.kind === "MARKET") query.set("marketId", scope.marketId);
  if (scope.kind === "LOCATION") {
    query.set("marketId", scope.marketId);
    query.set("locationId", scope.locationId);
  }
  return query;
}

export default function AdminPage() {
  const { state: context } = useAdminContext();
  const [attempt, setAttempt] = useState(0);
  const [loadedOverview, setLoadedOverview] = useState<{
    scopeKey: string;
    result: RpcResult<AdminOverviewView>;
  } | null>(null);
  const selectedScope = context.phase === "ready" ? context.selectedScope : null;
  const selectedScopeKey = selectedScope ? JSON.stringify(selectedScope) : null;
  const bootstrapOverview = context.phase === "ready" ? context.overview : null;
  const bootstrapMatchesSelection = Boolean(
    selectedScope &&
    bootstrapOverview &&
    JSON.stringify(bootstrapOverview.selectedScope) === JSON.stringify(selectedScope),
  );
  const visibleOverview: RpcResult<AdminOverviewView> | null =
    loadedOverview?.scopeKey === selectedScopeKey
      ? loadedOverview.result
      : bootstrapMatchesSelection && bootstrapOverview
        ? { ok: true, value: bootstrapOverview, requestId: "bootstrap" }
        : null;
  const timezone = useMemo(() => {
    if (context.phase !== "ready" || !selectedScope) return "UTC";
    const option = context.scopes.find((candidate) =>
      selectedScope.kind === "LOCATION"
        ? candidate.kind === "location" && candidate.locationId === selectedScope.locationId
        : selectedScope.kind === "MARKET"
          ? candidate.kind === "market" && candidate.marketId === selectedScope.marketId
          : false,
    );
    return option?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  }, [context, selectedScope]);

  useEffect(() => {
    if (!selectedScope) return;
    let active = true;
    if (bootstrapMatchesSelection) {
      return () => {
        active = false;
      };
    }
    setLoadedOverview(null);
    void fetch(`/api/admin/overview?${scopeQuery(selectedScope, timezone)}`)
      .then((response) => response.json() as Promise<RpcResult<AdminOverviewView>>)
      .then((payload) => {
        if (active) setLoadedOverview({ scopeKey: JSON.stringify(selectedScope), result: payload });
      })
      .catch(() => {
        if (active) {
          setLoadedOverview({
            scopeKey: JSON.stringify(selectedScope),
            result: {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Network error loading the operational overview.",
                requestId: "unavailable",
              },
            },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, bootstrapMatchesSelection, selectedScope, timezone]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Authoritative workload, exceptions, and material operations for the selected scope."
        action={
          <Badge variant="secondary">
            {selectedScope ? selectedScope.kind.toLowerCase() : "scope required"}
          </Badge>
        }
      />
      {context.phase === "ready" && selectedScope === null ? (
        <AdminPageState
          state="unavailable"
          title="Select an Admin scope"
          message="Choose a permitted market, location, or global scope from the header."
        />
      ) : null}
      {selectedScope && visibleOverview === null ? <AdminPageState state="loading" /> : null}
      {visibleOverview && !visibleOverview.ok ? (
        <AdminPageState
          state="error"
          message={visibleOverview.error.message}
          onRetry={() => setAttempt((value) => value + 1)}
          requestId={visibleOverview.error.requestId}
        />
      ) : null}
      {visibleOverview?.ok ? (
        <Suspense fallback={<AdminPageState state="loading" />}>
          <AdminOverviewViewContent overview={visibleOverview.value} />
        </Suspense>
      ) : null}
    </div>
  );
}
