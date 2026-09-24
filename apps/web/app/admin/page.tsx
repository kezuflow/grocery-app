"use client";

import { lazy, Suspense } from "react";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { useAdminContext } from "./admin-context-provider";
import { useAdminOverview } from "./admin-overview-provider";

const AdminOverviewViewContent = lazy(() =>
  import("@/components/admin/admin-overview-view").then((module) => ({
    default: module.AdminOverviewViewContent,
  })),
);

export default function AdminPage() {
  const { state: context, selectScope } = useAdminContext();
  const { result: visibleOverview, refresh } = useAdminOverview();
  const selectedScope = context.phase === "ready" ? context.selectedScope : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Operational work and attention for the selected scope."
        action={
          selectedScope ? (
            <Button onClick={refresh} size="sm" variant="outline">
              Refresh
            </Button>
          ) : null
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
          onRetry={refresh}
          requestId={visibleOverview.error.requestId}
        />
      ) : null}
      {visibleOverview?.ok ? (
        <Suspense fallback={<AdminPageState state="loading" />}>
          <AdminOverviewViewContent
            overview={visibleOverview.value}
            navigation={context.phase === "ready" ? context.context.navigation : []}
            scopeOptions={context.phase === "ready" ? context.scopes : []}
            onSelectScope={selectScope}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
