"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import type {
  AnalyticsMetricValue,
  AnalyticsOverviewView,
  MetricDefinitionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { ListPageSection, PageHeader } from "../../../components/admin/admin-shell";
import { AdminDashboardGrid, MetricCard } from "../../../components/admin/admin-compositions";
import { useAdminContext } from "../admin-context-provider";

type ReportState =
  | { phase: "loading"; key: string }
  | { phase: "error"; key: string; message: string }
  | {
      phase: "ready";
      key: string;
      definitions: ReadonlyArray<MetricDefinitionView>;
      overview: AnalyticsOverviewView;
    };

const groups = [
  ["ORDERS", "Orders"],
  ["FINANCE", "Money"],
  ["INVENTORY", "Products"],
  ["PROMOTIONS", "Promotion Codes"],
  ["DELIVERY", "Delivery"],
  ["CUSTOMERS", "Customers"],
] as const;
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

function reportValue(
  metric: AnalyticsMetricValue,
  definition: MetricDefinitionView,
): string | null {
  if (metric.availability !== "AVAILABLE" || metric.value === null) return null;
  if (definition.valueUnit === "MINOR_UNITS") {
    const currency = metric.dimensions.find((dimension) => dimension.key === "currency")?.value;
    if (!currency) return null;
    const formatter = new Intl.NumberFormat("en-PH", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(metric.value / 10 ** digits);
  }
  return new Intl.NumberFormat("en-PH").format(metric.value);
}

export default function AnalyticsPage() {
  const { state: admin } = useAdminContext();
  const scope = admin.phase === "ready" ? admin.selectedScope : null;
  const scopeKey = JSON.stringify(scope);
  const scopeOptions =
    admin.phase === "ready"
      ? admin.scopes.filter((option) =>
          scope?.kind === "LOCATION"
            ? option.kind === "location" && option.locationId === scope.locationId
            : scope?.kind === "MARKET"
              ? option.marketId === scope.marketId
              : true,
        )
      : [];
  const scopedCurrencies = [...new Set(scopeOptions.map((option) => option.currency))];
  const scopedTimezones = [...new Set(scopeOptions.map((option) => option.timezone))];
  const defaultTimezone = scopedTimezones.length === 1 ? scopedTimezones[0] : "";
  const defaultCurrency = scopedCurrencies.length === 1 ? scopedCurrencies[0] : "";
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [startDate, setStartDate] = useState(() =>
    Temporal.Now.plainDateISO(defaultTimezone || "Asia/Manila")
      .subtract({ days: 29 })
      .toString(),
  );
  const [endDate, setEndDate] = useState(() =>
    Temporal.Now.plainDateISO(defaultTimezone || "Asia/Manila").toString(),
  );
  const datesEdited = useRef(false);
  const [initializedDateZone, setInitializedDateZone] = useState<string | null>(
    defaultTimezone || null,
  );
  const [currency, setCurrency] = useState("");
  const [selection, setSelection] = useState<{ skuId: string; label: string } | null>(null);
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [preparedScopeKey, setPreparedScopeKey] = useState(scopeKey);
  const [state, setState] = useState<ReportState>({ phase: "loading", key: "" });
  const timezones = scopedTimezones;

  useEffect(() => {
    setTimezone(defaultTimezone);
    setCurrency(defaultCurrency);
    setSelection(null);
    setSearch("");
    setProductSearch("");
    setCursor(null);
    setPreparedScopeKey(scopeKey);
  }, [scopeKey, defaultTimezone, defaultCurrency]);

  useEffect(() => {
    if (!timezone || initializedDateZone === timezone) return;
    if (!datesEdited.current) {
      const today = Temporal.Now.plainDateISO(timezone);
      setStartDate(today.subtract({ days: 29 }).toString());
      setEndDate(today.toString());
    }
    setInitializedDateZone(timezone);
  }, [timezone, initializedDateZone]);

  const period = useMemo(() => {
    if (!timezone) return null;
    try {
      const start = Temporal.PlainDate.from(startDate);
      const end = Temporal.PlainDate.from(endDate);
      if (Temporal.PlainDate.compare(start, end) > 0) return null;
      return {
        startAt: start.toZonedDateTime(timezone).toInstant().toString(),
        endAt: end.add({ days: 1 }).toZonedDateTime(timezone).toInstant().toString(),
        timezone,
      };
    } catch {
      return null;
    }
  }, [startDate, endDate, timezone]);

  const queryKey = JSON.stringify([
    scopeKey,
    period,
    currency,
    selection?.skuId ?? null,
    productSearch,
    cursor,
    attempt,
  ]);
  const visibleState: ReportState =
    preparedScopeKey === scopeKey && state.key === queryKey
      ? state
      : { phase: "loading", key: queryKey };

  useEffect(() => {
    const controller = new AbortController();
    if (preparedScopeKey !== scopeKey) return;
    if (timezone && initializedDateZone !== timezone) return;
    if (!scope || !period) {
      setState({
        phase: "error",
        key: queryKey,
        message: !scope
          ? "Select an Admin location or scope to view reports."
          : !timezone
            ? "Select a reporting timezone."
            : "Choose a valid start and end date.",
      });
      return;
    }
    const query = new URLSearchParams({ ...period, scopeKind: scope.kind });
    if (scope.kind !== "GLOBAL") query.set("marketId", scope.marketId);
    if (scope.kind === "LOCATION") query.set("locationId", scope.locationId);
    query.set(
      "dimensions",
      JSON.stringify([
        ...(currency ? [{ key: "currency", value: currency }] : []),
        ...(selection ? [{ key: "skuId", value: selection.skuId }] : []),
      ]),
    );
    if (productSearch) query.set("productSearch", productSearch);
    if (cursor) query.set("productCursor", cursor);
    setState({ phase: "loading", key: queryKey });
    void (async () => {
      try {
        const [definitionResponse, overviewResponse] = await Promise.all([
          fetch(`/api/admin/analytics/definitions?${query}`, { signal: controller.signal }),
          fetch(`/api/admin/analytics/overview?${query}`, { signal: controller.signal }),
        ]);
        const definitions = (await definitionResponse.json()) as RpcResult<
          ReadonlyArray<MetricDefinitionView>
        >;
        const overview = (await overviewResponse.json()) as RpcResult<AnalyticsOverviewView>;
        if (!definitions.ok) throw new Error(definitions.error.message);
        if (!overview.ok) throw new Error(overview.error.message);
        if (!controller.signal.aborted)
          setState({
            phase: "ready",
            key: queryKey,
            definitions: definitions.value,
            overview: overview.value,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            phase: "error",
            key: queryKey,
            message: error instanceof Error ? error.message : "Reports could not be loaded.",
          });
      }
    })();
    return () => controller.abort();
  }, [
    scopeKey,
    scope,
    period,
    currency,
    selection,
    productSearch,
    cursor,
    attempt,
    preparedScopeKey,
    initializedDateZone,
    queryKey,
  ]);

  const options = visibleState.phase === "ready" ? visibleState.overview.productOptions : undefined;
  const reportedPeriod =
    visibleState.phase === "ready"
      ? {
          from: Temporal.Instant.from(visibleState.overview.window.startAt)
            .toZonedDateTimeISO(visibleState.overview.window.timezone)
            .toPlainDate()
            .toString(),
          through: Temporal.Instant.from(visibleState.overview.window.endAt)
            .subtract({ nanoseconds: 1 })
            .toZonedDateTimeISO(visibleState.overview.window.timezone)
            .toPlainDate()
            .toString(),
        }
      : null;
  const scopeLabel =
    scope?.kind === "LOCATION"
      ? (scopeOptions.find((option) => option.kind === "location")?.locationName ??
        scope.locationId)
      : scope?.kind === "MARKET"
        ? (scopeOptions[0]?.marketCode ?? scope.marketId)
        : "Global";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Approved reports for the selected scope and period."
        action={
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Refresh
          </Button>
        }
      />
      <section
        aria-label="Report filters"
        className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fm-border)] px-4 py-3 text-sm sm:px-5">
          <h2 className="font-semibold">Report filters</h2>
          <span className="text-[var(--fm-text-muted)]">Scope: {scopeLabel}</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
          <label className="space-y-1 text-sm">
            From
            <Input
              type="date"
              value={startDate}
              onChange={(event) => {
                datesEdited.current = true;
                setStartDate(event.target.value);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            Through
            <Input
              type="date"
              value={endDate}
              onChange={(event) => {
                datesEdited.current = true;
                setEndDate(event.target.value);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            Timezone
            <select
              className={selectClass}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              <option value="">Select timezone</option>
              {timezones.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            Currency
            <select
              className={selectClass}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="">Select currency</option>
              {scopedCurrencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
        </div>
        <details className="border-t border-[var(--fm-border)] px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-sm font-medium">Product breakdown</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setProductSearch(search.trim());
                setCursor(null);
              }}
            >
              <label className="flex-1 space-y-1 text-sm">
                Find a purchased Product
                <Input
                  value={search}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Product or selling option"
                />
              </label>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <label className="space-y-1 text-sm">
              Product selling option
              <select
                className={selectClass}
                value={selection?.skuId ?? ""}
                onChange={(event) => {
                  const option = options?.items.find((item) => item.skuId === event.target.value);
                  setSelection(
                    option
                      ? {
                          skuId: option.skuId,
                          label: `${option.productName} · ${option.optionName}`,
                        }
                      : null,
                  );
                }}
              >
                <option value="">Select to view Product quantities</option>
                {selection && !options?.items.some((item) => item.skuId === selection.skuId) ? (
                  <option value={selection.skuId}>{selection.label}</option>
                ) : null}
                {options?.items.map((option) => (
                  <option key={option.skuId} value={option.skuId}>
                    {option.productName} · {option.optionName}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {cursor ? (
                <Button variant="outline" onClick={() => setCursor(null)}>
                  First Product page
                </Button>
              ) : null}
              {options?.nextCursor ? (
                <Button variant="outline" onClick={() => setCursor(options.nextCursor)}>
                  More Products
                </Button>
              ) : null}
            </div>
          </div>
        </details>
      </section>
      {visibleState.phase === "loading" ? (
        <div role="status" aria-label="Loading Analytics">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}
      {visibleState.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Reports could not be loaded</AlertTitle>
          <AlertDescription>{visibleState.message}</AlertDescription>
        </Alert>
      ) : null}
      {visibleState.phase === "ready" ? (
        <>
          <p className="text-sm text-muted-foreground">
            {reportedPeriod?.from} through {reportedPeriod?.through} · {scopeLabel} ·{" "}
            {visibleState.overview.window.timezone} · {currency || "Currency not selected"}. Updated{" "}
            {new Date(visibleState.overview.freshness.computedAt).toLocaleString("en-PH", {
              timeZone: visibleState.overview.window.timezone,
            })}
            .
          </p>
          {groups.map(([category, title]) => {
            const definitions = visibleState.definitions.filter(
              (definition) => definition.category === category,
            );
            if (!definitions.length) return null;
            return (
              <ListPageSection
                key={category}
                title={title}
                description={
                  category === "FINANCE"
                    ? "Received and refunded amounts are separate. Neither figure is profit."
                    : category === "DELIVERY"
                      ? "Charges and recorded costs cover the same paid Orders. Unknown costs remain unavailable."
                      : category === "INVENTORY"
                        ? (selection?.label ??
                          "Open Product breakdown to choose a purchased selling option.")
                        : undefined
                }
              >
                <AdminDashboardGrid ariaLabel={title} className="p-4">
                  {definitions.map((definition) => {
                    const metric = visibleState.overview.metrics.find(
                      (candidate) =>
                        candidate.metricCode === definition.code &&
                        candidate.definitionVersion === definition.version,
                    );
                    return (
                      <MetricCard
                        key={definition.code}
                        className="xl:col-span-4"
                        label={definition.displayName}
                        value={metric ? reportValue(metric, definition) : null}
                        unavailableReason={
                          metric?.unavailableReason ?? "This figure is unavailable."
                        }
                        detail={definition.formulaDescription}
                      />
                    );
                  })}
                </AdminDashboardGrid>
              </ListPageSection>
            );
          })}
          <details className="rounded-lg border p-4 text-sm">
            <summary className="cursor-pointer font-medium">How these figures are counted</summary>
            <p className="mt-3 text-[var(--fm-text-muted)]">
              {visibleState.overview.freshness.sourceWatermark
                ? `Latest source record: ${new Date(visibleState.overview.freshness.sourceWatermark).toLocaleString("en-PH", { timeZone: visibleState.overview.window.timezone })}.`
                : "Source record timestamp unavailable."}
            </p>
            <ul className="mt-3 space-y-3">
              {visibleState.definitions.map((definition) => (
                <li key={definition.code}>
                  <strong>{definition.displayName}</strong> (version {definition.version}):{" "}
                  {definition.formulaDescription}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
