"use client";

import type { AdminOverviewView } from "@freshmarkets/contracts";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { lazy, Suspense } from "react";
import { AdminChartCard, AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const AdminBarChart = lazy(() => import("./admin-bar-chart"));

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export function AdminOverviewViewContent({ overview }: { overview: AdminOverviewView }) {
  const freshness = `Computed ${new Date(overview.freshness.computedAt).toLocaleString("en-PH", {
    timeZone: overview.timezone,
  })}`;
  return (
    <div className="space-y-4">
      <AdminDashboardGrid ariaLabel="Operational metrics" className="xl:grid-cols-4">
        {overview.cards.map((card) => (
          <MetricCard
            className="xl:col-span-1"
            detail={card.value === null ? "Not included in the selected scope." : "Core read model"}
            freshness={freshness}
            href={card.href}
            key={card.code}
            label={card.label}
            unavailableReason={card.unavailableReason ?? undefined}
            value={card.value === null ? null : String(card.value)}
          />
        ))}
      </AdminDashboardGrid>

      {overview.deniedSections.length ? (
        <Card className="gap-3 border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] py-4 shadow-none">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4" aria-hidden /> Sections outside current access
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 px-4">
            {overview.deniedSections.map((section) => (
              <Badge key={section} variant="secondary">
                {section}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <AdminDashboardGrid ariaLabel="Operational workload and exceptions">
        <AdminChartCard
          className="md:col-span-2 xl:col-span-7"
          title="Operational workload"
          description="Current fulfillment records grouped by canonical stage."
          summary={overview.workloadStages.map((stage) => `${stage.label}: ${stage.count}`)}
        >
          {overview.workloadStages.length ? (
            <div className="h-72 pt-4" aria-hidden="true">
              <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-muted" />}>
                <AdminBarChart
                  data={overview.workloadStages}
                  categoryKey="label"
                  valueKey="count"
                />
              </Suspense>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-[var(--fm-text-muted)]">
              No fulfillment workload in the selected scope.
            </p>
          )}
        </AdminChartCard>

        <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)] md:col-span-2 xl:col-span-5">
          <CardHeader className="border-b px-4 py-4 sm:px-5">
            <CardTitle>Priority exceptions</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {overview.exceptions.length ? (
              <ul className="divide-y divide-[var(--fm-border)]">
                {overview.exceptions.map((exception) => (
                  <li
                    className="flex items-start gap-3 px-4 py-3 sm:px-5"
                    key={exception.referenceId}
                  >
                    <Badge
                      className={
                        exception.severity === "CRITICAL" || exception.severity === "HIGH"
                          ? "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)]"
                          : undefined
                      }
                      variant="secondary"
                    >
                      {exception.severity}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{label(exception.kind)}</p>
                      <p className="truncate text-xs text-[var(--fm-text-muted)]">
                        {exception.detail}
                      </p>
                    </div>
                    <a aria-label={`Open ${exception.kind}`} href={exception.href}>
                      <ArrowUpRight className="size-4" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No open exceptions in the selected scope.
              </p>
            )}
          </CardContent>
        </Card>
      </AdminDashboardGrid>

      <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
        <CardHeader className="border-b px-4 py-4 sm:px-5">
          <CardTitle>Recent material operations</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {overview.recentOperations.length ? (
            <ul className="divide-y divide-[var(--fm-border)]">
              {overview.recentOperations.map((operation) => (
                <li
                  className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5"
                  key={operation.auditEventId}
                >
                  <span className="font-medium">{label(operation.action)}</span>
                  <time
                    className="text-xs text-[var(--fm-text-muted)]"
                    dateTime={operation.occurredAt}
                  >
                    {new Date(operation.occurredAt).toLocaleString("en-PH", {
                      timeZone: overview.timezone,
                    })}
                  </time>
                  <span className="font-mono text-xs text-[var(--fm-text-muted)]">
                    {operation.resourceType} · {operation.resourceId}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              No authorized material operations are available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
