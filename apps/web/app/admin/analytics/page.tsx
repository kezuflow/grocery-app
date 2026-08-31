"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsOverviewView,
  AnalyticsWindow,
  MetricSeriesView,
  MetricDefinitionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminContext } from "../admin-context-provider";
import { AdminDashboardGrid, MetricCard } from "../../../components/admin/admin-compositions";
import { AnalyticsChartGrid } from "../../../components/admin/analytics-chart-grid";

type AnalyticsState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      definitions: ReadonlyArray<MetricDefinitionView>;
      overview: AnalyticsOverviewView;
      series: ReadonlyArray<MetricSeriesView>;
    };

function currentWindow(): AnalyticsWindow {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila",
  };
}

function formatNumber(value: number | null): string {
  return value === null ? "Unavailable" : new Intl.NumberFormat("en-PH").format(value);
}

function formatInstant(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function errorMessage(code: string, message: string): string {
  if (code === "FORBIDDEN")
    return "Analytics access requires the analytics.read capability for this scope.";
  if (code === "VALIDATION_FAILED")
    return "The analytics window or timezone is invalid. Refresh and try again.";
  return message;
}

export default function AnalyticsPage() {
  const { state: adminContext } = useAdminContext();
  const [state, setState] = useState<AnalyticsState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [currency, setCurrency] = useState("");
  const [baseUnit, setBaseUnit] = useState("");
  const window = useMemo(currentWindow, []);

  const load = useCallback(async () => {
    if (adminContext.phase !== "ready" || adminContext.selectedScope === null) {
      setState({
        phase: "error",
        message: "Select an Admin scope to load Analytics.",
        requestId: null,
      });
      return;
    }
    setState({ phase: "loading" });
    const query = new URLSearchParams({
      startAt: window.startAt,
      endAt: window.endAt,
      timezone: window.timezone,
    });
    query.set("scopeKind", adminContext.selectedScope.kind);
    if (adminContext.selectedScope.kind === "MARKET") {
      query.set("marketId", adminContext.selectedScope.marketId);
    }
    if (adminContext.selectedScope.kind === "LOCATION") {
      query.set("marketId", adminContext.selectedScope.marketId);
      query.set("locationId", adminContext.selectedScope.locationId);
    }
    const dimensions = [
      ...(currency ? [{ key: "currency", value: currency }] : []),
      ...(baseUnit ? [{ key: "baseUnit", value: baseUnit }] : []),
    ];
    if (dimensions.length > 0) query.set("dimensions", JSON.stringify(dimensions));
    try {
      const [definitionsResponse, overviewResponse] = await Promise.all([
        fetch(`/api/admin/analytics/definitions?${query.toString()}`),
        fetch(`/api/admin/analytics/overview?${query.toString()}`),
      ]);
      const definitions = (await definitionsResponse.json()) as RpcResult<
        ReadonlyArray<MetricDefinitionView>
      >;
      if (!definitions.ok) {
        setState({
          phase: "error",
          message: errorMessage(definitions.error.code, definitions.error.message),
          requestId: definitions.error.requestId,
        });
        return;
      }
      const overview = (await overviewResponse.json()) as RpcResult<AnalyticsOverviewView>;
      if (!overview.ok) {
        setState({
          phase: "error",
          message: errorMessage(overview.error.code, overview.error.message),
          requestId: overview.error.requestId,
        });
        return;
      }
      const series = await Promise.all(
        overview.value.metrics.slice(0, 4).map(async (metric) => {
          const seriesQuery = new URLSearchParams(query);
          seriesQuery.set("definitionVersion", String(metric.definitionVersion));
          try {
            const response = await fetch(
              `/api/admin/analytics/metrics/${encodeURIComponent(metric.metricCode)}?${seriesQuery}`,
            );
            const result = (await response.json()) as RpcResult<MetricSeriesView>;
            return result.ok ? result.value : null;
          } catch {
            return null;
          }
        }),
      );
      setState({
        phase: "ready",
        definitions: definitions.value,
        overview: overview.value,
        series: series.filter((metric): metric is MetricSeriesView => metric !== null),
      });
    } catch {
      setState({ phase: "error", message: "Network error loading Analytics.", requestId: null });
    }
  }, [adminContext, baseUnit, currency, window]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Analytics"
        description="Versioned operational metrics from authoritative Core read models. Values remain unavailable when their source policy is unresolved."
        action={
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium text-[var(--fm-text-muted)]">
              Currency
              <input
                aria-label="Analytics currency"
                className="w-24 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 py-1.5 text-sm uppercase text-[var(--fm-text)]"
                inputMode="text"
                maxLength={3}
                placeholder="All"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.trim().toUpperCase())}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-[var(--fm-text-muted)]">
              Base unit
              <select
                aria-label="Analytics base unit"
                className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-2 py-1.5 text-sm text-[var(--fm-text)]"
                value={baseUnit}
                onChange={(event) => setBaseUnit(event.target.value)}
              >
                <option value="">All</option>
                <option value="GRAM">Gram</option>
                <option value="MILLILITER">Milliliter</option>
                <option value="PIECE">Piece</option>
              </select>
            </label>
            <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        }
      />

      {state.phase === "loading" ? <AnalyticsLoading /> : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Analytics could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
            <br />
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        <AnalyticsReady
          definitions={state.definitions}
          overview={state.overview}
          series={state.series}
        />
      ) : null}
    </div>
  );
}

function AnalyticsReady({
  definitions,
  overview,
  series,
}: {
  definitions: ReadonlyArray<MetricDefinitionView>;
  overview: AnalyticsOverviewView;
  series: ReadonlyArray<MetricSeriesView>;
}) {
  return (
    <>
      <AdminDashboardGrid ariaLabel="Analytics context">
        <MetricCard
          className="xl:col-span-3"
          label="Window"
          value={`${overview.window.startAt.slice(0, 10)} → ${overview.window.endAt.slice(0, 10)}`}
        />
        <MetricCard className="xl:col-span-3" label="Timezone" value={overview.window.timezone} />
        <MetricCard
          className="xl:col-span-3"
          label="Scope"
          value={
            overview.scope.kind === "global"
              ? "Global"
              : overview.scope.kind === "market"
                ? `Market ${overview.scope.marketId}`
                : `Location ${overview.scope.locationId}`
          }
        />
        <MetricCard
          className="xl:col-span-3"
          label="Source freshness"
          value={formatInstant(overview.freshness.sourceWatermark)}
          detail={`Computed ${formatInstant(overview.freshness.computedAt)}`}
        />
      </AdminDashboardGrid>

      <AnalyticsChartGrid series={series} />

      <ListPageSection
        title="Metric summary"
        description="Core-provided values for the selected window; unavailable metrics are not represented as zero."
      >
        {overview.metrics.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
            No metrics are available for this window and scope.
          </p>
        ) : (
          <AdminDashboardGrid ariaLabel="Metric summary" className="p-4">
            {overview.metrics.map((metric) => (
              <MetricCard
                key={`${metric.metricCode}:${metric.definitionVersion}`}
                className="xl:col-span-4"
                label={metric.metricCode}
                value={metric.availability === "AVAILABLE" ? formatNumber(metric.value) : null}
                unavailableReason={
                  metric.unavailableReason ?? "Metric is unavailable for this context."
                }
                detail={
                  <>
                    <span>Definition v{metric.definitionVersion}</span>
                    {metric.dimensions.length > 0 ? (
                      <span className="mt-1 block">
                        {metric.dimensions
                          .map((dimension) => `${dimension.key}: ${dimension.value}`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </>
                }
              />
            ))}
          </AdminDashboardGrid>
        )}
      </ListPageSection>

      <ListPageSection
        title="Definitions"
        description="Published formula descriptions, versions, dimensions, and freshness metadata returned by Core."
      >
        {definitions.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
            No Analytics definitions are published for this account.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Formula description</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((definition) => (
                  <TableRow key={`${definition.code}:${definition.version}`}>
                    <TableCell>
                      <div className="font-medium">{definition.displayName}</div>
                      <div className="font-mono text-xs text-[var(--fm-text-muted)]">
                        {definition.code}
                      </div>
                    </TableCell>
                    <TableCell>v{definition.version}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={definition.availability === "AVAILABLE" ? "success" : "warning"}
                      >
                        {definition.availability}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="max-w-sm text-xs">
                      {definition.formulaDescription}
                      {definition.unavailableReason ? (
                        <div className="mt-1 text-[var(--fm-warning)]">
                          {definition.unavailableReason}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--fm-text-muted)]">
                      {definition.freshness
                        ? formatInstant(definition.freshness.sourceWatermark)
                        : "Not available"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListPageSection>
    </>
  );
}

function AnalyticsLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading Analytics">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
