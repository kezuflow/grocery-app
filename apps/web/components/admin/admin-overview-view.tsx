"use client";

import type {
  AdminNavigationItem,
  AdminOverviewView,
  AdminScopeOptionView,
  AdminSelectedScope,
} from "@freshmarkets/contracts";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { Badge } from "../ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

import { AdminNotificationList } from "./admin-notifications";

const GLOBAL_CARD_ORDER = [
  "OPEN_EXCEPTIONS",
  "OPEN_ORDERS",
  "PAYMENT_ATTENTION",
  "ACTIVE_PRODUCTS",
] as const;

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export function AdminOverviewViewContent({
  overview,
  navigation,
  scopeOptions,
  onSelectScope,
}: {
  overview: AdminOverviewView;
  navigation: ReadonlyArray<AdminNavigationItem>;
  scopeOptions: ReadonlyArray<AdminScopeOptionView>;
  onSelectScope?: (scope: AdminSelectedScope) => void;
}) {
  const freshness = `Computed ${new Date(overview.freshness.computedAt).toLocaleString("en-PH", {
    timeZone: overview.timezone,
  })}`;
  const isGlobal = overview.selectedScope.kind === "GLOBAL";
  const isLocation = overview.selectedScope.kind === "LOCATION";
  const cards = isGlobal
    ? [...overview.cards].sort(
        (left, right) =>
          GLOBAL_CARD_ORDER.indexOf(left.code) - GLOBAL_CARD_ORDER.indexOf(right.code),
      )
    : overview.cards.filter((card) => card.code === "OPEN_EXCEPTIONS");
  const exceptionCard = overview.cards.find((card) => card.code === "OPEN_EXCEPTIONS");
  const exceptionsAvailable = exceptionCard?.value !== null && exceptionCard?.value !== undefined;
  const operationsAvailable = !overview.deniedSections.includes("operations");
  const auditAvailable = !overview.deniedSections.includes("audit");
  const locations = new Map(
    scopeOptions
      .filter(
        (option): option is Extract<AdminScopeOptionView, { kind: "location" }> =>
          option.kind === "location",
      )
      .map((option) => [option.locationId, option]),
  );
  const fulfillmentHref = isLocation
    ? navigation.find((item) => item.code === "fulfillment" && item.scopeKinds.includes("LOCATION"))
        ?.href
    : undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {isGlobal ? "Across locations" : isLocation ? "At this location" : "In this market"}
          </h2>
          <p className="text-sm text-[var(--fm-text-muted)]">
            {isGlobal
              ? "Current work and attention across your authorized locations."
              : `Fulfillment status and exceptions in the selected ${isLocation ? "location" : "market"}.`}
          </p>
        </div>
        <p className="text-xs text-[var(--fm-text-muted)]">{freshness}</p>
      </div>
      <AdminDashboardGrid ariaLabel="Operational metrics" className="xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard
            className="xl:col-span-1"
            detail={
              isGlobal && card.code === "OPEN_EXCEPTIONS" && card.value !== null
                ? "Select a location in the header or below to inspect its queue."
                : undefined
            }
            href={
              card.value === null || (isGlobal && card.code === "OPEN_EXCEPTIONS")
                ? undefined
                : card.href
            }
            key={card.code}
            label={card.label}
            unavailableReason={card.unavailableReason ?? undefined}
            value={card.value === null ? null : String(card.value)}
          />
        ))}
      </AdminDashboardGrid>

      <AdminDashboardGrid ariaLabel="Operational workload and exceptions">
        <Card
          className={`min-w-0 gap-0 py-0 shadow-[var(--fm-shadow-card)] md:col-span-2 ${exceptionsAvailable ? "xl:col-span-7" : "xl:col-span-12"}`}
        >
          <CardHeader className="border-b px-4 py-4 sm:px-5">
            <CardTitle>Fulfillment by status</CardTitle>
            <CardDescription>Record counts include completed stages.</CardDescription>
            {fulfillmentHref ? (
              <CardAction>
                <Link
                  className="text-sm font-medium text-[var(--fm-admin-accent-strong)] hover:underline"
                  href={fulfillmentHref}
                  prefetch={false}
                >
                  Open fulfillment
                </Link>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="px-0">
            {!operationsAvailable ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                Fulfillment status is outside your current access.
              </p>
            ) : overview.workloadStages.length ? (
              <ul className="grid sm:grid-cols-2">
                {overview.workloadStages.map((stage) => (
                  <li
                    className="flex items-center justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-3 text-sm sm:px-5"
                    key={stage.code}
                  >
                    <span className="capitalize">{stage.label}</span>
                    <span className="font-semibold tabular-nums">
                      {stage.count.toLocaleString("en-PH")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No fulfillment records in the selected scope.
              </p>
            )}
          </CardContent>
        </Card>

        {exceptionsAvailable ? (
          <Card className="min-w-0 gap-0 py-0 shadow-[var(--fm-shadow-card)] md:col-span-2 xl:col-span-5">
            <CardHeader className="border-b px-4 py-4 sm:px-5">
              <CardTitle>Priority exceptions</CardTitle>
              {isGlobal ? (
                <CardDescription>
                  Select a location in the queue to inspect its exceptions.
                </CardDescription>
              ) : null}
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
                        {isGlobal ? (
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            {locations.get(exception.locationId ?? "")?.locationName ??
                              "Location outside current selection"}
                          </p>
                        ) : null}
                      </div>
                      {isGlobal ? (
                        locations.has(exception.locationId ?? "") && onSelectScope ? (
                          <button
                            className="text-xs font-medium text-[var(--fm-admin-accent-strong)] hover:underline"
                            onClick={() => {
                              const location = locations.get(exception.locationId ?? "");
                              if (location) {
                                onSelectScope({
                                  kind: "LOCATION",
                                  marketId: location.marketId,
                                  locationId: location.locationId,
                                });
                              }
                            }}
                            type="button"
                          >
                            Select location
                          </button>
                        ) : null
                      ) : overview.selectedScope.kind === "LOCATION" &&
                        exception.locationId === overview.selectedScope.locationId ? (
                        <a
                          aria-label={`Open ${label(exception.kind)} exception`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--fm-admin-accent-strong)] hover:underline"
                          href={exception.href}
                        >
                          View <ArrowUpRight className="size-4" aria-hidden />
                        </a>
                      ) : null}
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
        ) : null}
      </AdminDashboardGrid>

      <Card id="notifications" className="scroll-mt-20 gap-0 py-0">
        <CardHeader className="border-b px-4 py-4">
          <CardTitle>Recent notifications</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="max-h-96 overflow-y-auto">
            <AdminNotificationList
              notifications={overview.notifications}
              timezone={overview.timezone}
              onSelectScope={onSelectScope}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 py-0 shadow-[var(--fm-shadow-card)]">
        <CardHeader className="border-b px-4 py-4 sm:px-5">
          <CardTitle>Recent material operations</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {!auditAvailable ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              Material operations are outside your current access.
            </p>
          ) : overview.recentOperations.length ? (
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

      {overview.deniedSections.length ? (
        <details className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Sections outside current access</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {overview.deniedSections.map((section) => (
              <Badge key={section} variant="secondary">
                {section}
              </Badge>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
