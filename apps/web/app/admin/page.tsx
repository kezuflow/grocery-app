"use client";

import { lazy, Suspense } from "react";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { Button } from "@/components/admin/shadcn/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/shadcn/card";
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
    <section
      className="fm-admin-overview min-h-[calc(100svh-3.5rem)] p-4 sm:p-6"
      aria-labelledby="admin-page-title"
    >
      <Card className="gap-0 border-border py-0 shadow-none">
        <CardHeader className="gap-1 px-4 pt-6 pb-5 sm:px-6 sm:pt-8 sm:pb-7">
          <CardTitle>
            <h1 id="admin-page-title" className="text-2xl font-semibold tracking-tight">
              Overview
            </h1>
          </CardTitle>
          <CardDescription>Operational work and attention for the selected scope.</CardDescription>
          {selectedScope ? (
            <CardAction>
              <Button onClick={refresh} size="sm" variant="outline">
                Refresh
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="px-4 pb-6 sm:px-6 sm:pb-8">
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
        </CardContent>
      </Card>
    </section>
  );
}
