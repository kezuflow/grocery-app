"use client";
import { lazy, Suspense, useState } from "react";
import type { AdminCommerceOverview } from "@freshmarkets/contracts";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { Button } from "@/components/admin/shadcn/button";
import { useAdminContext } from "./admin-context-provider";
import { useAdminOverview } from "./admin-overview-provider";
import { AdminCommerceOverviewSection } from "@/components/admin/admin-commerce-overview";

const AdminOverviewViewContent = lazy(() =>
  import("@/components/admin/admin-overview-view").then((module) => ({
    default: module.AdminOverviewViewContent,
  })),
);

export default function AdminPage() {
  const [period, setPeriod] = useState<AdminCommerceOverview["period"]>("30d");
  const { state: context, selectScope } = useAdminContext();
  const { result: visibleOverview, refresh } = useAdminOverview();
  const selectedScope = context.phase === "ready" ? context.selectedScope : null;

  return (
    <section
      className="fm-admin-overview min-h-[calc(100svh-3.5rem)] p-4 sm:p-6"
      aria-labelledby="admin-page-title"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 id="admin-page-title" className="text-2xl font-semibold tracking-tight">
              Overview
            </h1>
            <p className="text-sm text-muted-foreground">
              Your store’s performance and daily operations in one place.
            </p>
          </div>
          {selectedScope ? (
            <Button onClick={refresh} size="sm" variant="outline">
              Refresh
            </Button>
          ) : null}
        </header>
        <div className="flex min-w-0 flex-col gap-8">
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
            <>
              <AdminCommerceOverviewSection
                period={period}
                onPeriodChange={setPeriod}
                scope={visibleOverview.value.selectedScope}
                timezone={visibleOverview.value.timezone}
                refreshKey={JSON.stringify([
                  visibleOverview.value.generatedAt,
                  context.phase === "ready" ? context.context.staffId : null,
                  context.phase === "ready" ? context.context.scopes : [],
                  context.phase === "ready" ? context.context.capabilities : [],
                ])}
              />
              <Suspense fallback={<AdminPageState state="loading" />}>
                <AdminOverviewViewContent
                  overview={visibleOverview.value}
                  navigation={context.phase === "ready" ? context.context.navigation : []}
                  scopeOptions={context.phase === "ready" ? context.scopes : []}
                  onSelectScope={selectScope}
                />
              </Suspense>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
