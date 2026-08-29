"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsOverviewView,
  AnalyticsWindow,
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

type AnalyticsState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | {
      phase: "ready";
      definitions: ReadonlyArray<MetricDefinitionView>;
      overview: AnalyticsOverviewView;
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
  const [state, setState] = useState<AnalyticsState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const window = useMemo(currentWindow, []);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    const query = new URLSearchParams({
      startAt: window.startAt,
      endAt: window.endAt,
      timezone: window.timezone,
    });
    try {
      const [definitionsResponse, overviewResponse] = await Promise.all([
        fetch("/api/admin/analytics/definitions"),
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
      setState({ phase: "ready", definitions: definitions.value, overview: overview.value });
    } catch {
      setState({ phase: "error", message: "Network error loading Analytics.", requestId: null });
    }
  }, [window]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Analytics"
        description="Versioned operational metrics from authoritative Core read models. Values remain unavailable when their source policy is unresolved."
        action={
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Refresh
          </Button>
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
        <AnalyticsReady definitions={state.definitions} overview={state.overview} />
      ) : null}
    </div>
  );
}

function AnalyticsReady({
  definitions,
  overview,
}: {
  definitions: ReadonlyArray<MetricDefinitionView>;
  overview: AnalyticsOverviewView;
}) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Analytics context">
        <ContextItem
          label="Window"
          value={`${overview.window.startAt.slice(0, 10)} → ${overview.window.endAt.slice(0, 10)}`}
        />
        <ContextItem label="Timezone" value={overview.window.timezone} />
        <ContextItem
          label="Scope"
          value={
            overview.scope.kind === "global"
              ? "Global"
              : overview.scope.kind === "market"
                ? `Market ${overview.scope.marketId}`
                : `Location ${overview.scope.locationId}`
          }
        />
        <ContextItem
          label="Source freshness"
          value={formatInstant(overview.freshness.sourceWatermark)}
          detail={`Computed ${formatInstant(overview.freshness.computedAt)}`}
        />
      </section>

      <ListPageSection
        title="Metric summary"
        description="Core-provided values for the selected window; unavailable metrics are not represented as zero."
      >
        {overview.metrics.length === 0 ? (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
            No metrics are available for this window and scope.
          </p>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview.metrics.map((metric) => (
              <article
                key={`${metric.metricCode}:${metric.definitionVersion}`}
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{metric.metricCode}</h3>
                  <StatusBadge tone={metric.availability === "AVAILABLE" ? "success" : "warning"}>
                    {metric.availability}
                  </StatusBadge>
                </div>
                <p className="mt-3 text-2xl font-bold">
                  {metric.availability === "AVAILABLE" ? formatNumber(metric.value) : "Unavailable"}
                </p>
                <p className="mt-2 text-xs text-[var(--fm-text-muted)]">
                  Definition v{metric.definitionVersion}
                </p>
                {metric.unavailableReason ? (
                  <p className="mt-2 text-xs text-[var(--fm-warning)]">
                    {metric.unavailableReason}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
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

function ContextItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[var(--fm-text-muted)]">{detail}</p> : null}
    </div>
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
