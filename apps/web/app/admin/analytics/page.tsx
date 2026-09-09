"use client";

import { useEffect, useMemo, useState } from "react";
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
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      definitions: ReadonlyArray<MetricDefinitionView>;
      overview: AnalyticsOverviewView;
    };

const groups = [
  ["ORDERS", "Orders"],
  ["FINANCE", "Money"],
  ["INVENTORY", "Products"],
  ["PROMOTIONS", "Promotions"],
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
  const scopeOption =
    admin.phase === "ready"
      ? admin.scopes.find((option) =>
          scope?.kind === "LOCATION"
            ? option.kind === "location" && option.locationId === scope.locationId
            : scope?.kind === "MARKET"
              ? option.marketId === scope.marketId
              : true,
        )
      : undefined;
  const defaultTimezone = scopeOption?.timezone ?? "Asia/Manila";
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [startDate, setStartDate] = useState(() =>
    Temporal.Now.plainDateISO(defaultTimezone).subtract({ days: 29 }).toString(),
  );
  const [endDate, setEndDate] = useState(() =>
    Temporal.Now.plainDateISO(defaultTimezone).toString(),
  );
  const [currency, setCurrency] = useState("");
  const [selection, setSelection] = useState<{ skuId: string; label: string } | null>(null);
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReportState>({ phase: "loading" });
  const currencies =
    admin.phase === "ready" ? [...new Set(admin.scopes.map((option) => option.currency))] : [];
  const timezones =
    admin.phase === "ready"
      ? [...new Set([defaultTimezone, ...admin.scopes.map((option) => option.timezone)])]
      : [defaultTimezone];

  useEffect(() => {
    setTimezone(defaultTimezone);
    setCurrency(scopeOption?.currency ?? "");
    setSelection(null);
    setCursor(null);
  }, [scopeKey, defaultTimezone, scopeOption?.currency]);

  const period = useMemo(() => {
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

  useEffect(() => {
    const controller = new AbortController();
    if (!scope || !period) {
      setState({
        phase: "error",
        message: !scope
          ? "Select an Admin location or scope to view reports."
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
    setState({ phase: "loading" });
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
          setState({ phase: "ready", definitions: definitions.value, overview: overview.value });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Reports could not be loaded.",
          });
      }
    })();
    return () => controller.abort();
  }, [scope, period, currency, selection, productSearch, cursor, attempt]);

  const options = state.phase === "ready" ? state.overview.productOptions : undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Orders, money, Products and customers for the period you choose."
      />
      <section
        aria-label="Report filters"
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="space-y-1 text-sm">
          From
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          Through
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          Timezone
          <select
            className={selectClass}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
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
            {currencies.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <form
          className="flex items-end gap-2 sm:col-span-2"
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
        <label className="space-y-1 text-sm sm:col-span-2">
          Product selling option
          <select
            className={selectClass}
            value={selection?.skuId ?? ""}
            onChange={(event) => {
              const option = options?.items.find((item) => item.skuId === event.target.value);
              setSelection(
                option
                  ? { skuId: option.skuId, label: `${option.productName} · ${option.optionName}` }
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
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
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
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Refresh
          </Button>
        </div>
      </section>
      {state.phase === "loading" ? (
        <div role="status" aria-label="Loading Analytics">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}
      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Reports could not be loaded</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.phase === "ready" ? (
        <>
          <p className="text-sm text-muted-foreground">
            {startDate} through {endDate} · {state.overview.window.timezone}. Updated{" "}
            {new Date(state.overview.freshness.computedAt).toLocaleString("en-PH", {
              timeZone: state.overview.window.timezone,
            })}
            .
          </p>
          {groups.map(([category, title]) => {
            const definitions = state.definitions.filter(
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
                        ? (selection?.label ?? "Choose one purchased selling option above.")
                        : undefined
                }
              >
                <AdminDashboardGrid ariaLabel={title} className="p-4">
                  {definitions.map((definition) => {
                    const metric = state.overview.metrics.find(
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
            <ul className="mt-3 space-y-3">
              {state.definitions.map((definition) => (
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
