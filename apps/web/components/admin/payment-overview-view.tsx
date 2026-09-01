"use client";

import type { AdminPaymentOverview } from "@freshmarkets/contracts";
import { lazy, Suspense } from "react";
import { AdminChartCard, AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { ListPageSection, StatusBadge } from "./admin-shell";

const AdminBarChart = lazy(() => import("./admin-bar-chart"));

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export function PaymentOverviewView({ overview }: { overview: AdminPaymentOverview }) {
  const workload = Object.entries(overview.intentCounts)
    .filter(([code]) => code !== "total")
    .map(([code, count]) => ({ code, count }));
  const hasWorkload = workload.some(({ count }) => count > 0);
  return (
    <div className="space-y-4">
      <AdminDashboardGrid ariaLabel="Payment workload" className="xl:grid-cols-4">
        <MetricCard
          className="xl:col-span-1"
          label="Payment intents"
          value={String(overview.intentCounts.total)}
        />
        <MetricCard
          className="xl:col-span-1"
          label="Requires action"
          value={String(overview.intentCounts.actionRequired)}
        />
        <MetricCard
          className="xl:col-span-1"
          label="Open reconciliation"
          value={String(overview.openReconciliationCount)}
          href="/admin/payments/reconciliation"
        />
        <MetricCard
          className="xl:col-span-1"
          label="Pending refunds"
          value={String(overview.pendingRefundCount)}
        />
      </AdminDashboardGrid>

      <AdminDashboardGrid ariaLabel="Payment status and settled volume">
        <AdminChartCard
          className="md:col-span-2 xl:col-span-7"
          title="Payment workload"
          description="Canonical payment intents grouped by current state."
          summary={workload.map((item) => `${item.code}: ${item.count}`)}
        >
          {hasWorkload ? (
            <div className="h-72 pt-4" aria-hidden="true">
              <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-muted" />}>
                <AdminBarChart data={workload} categoryKey="code" valueKey="count" />
              </Suspense>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-[var(--fm-text-muted)]">
              No payment workload in the selected scope.
            </p>
          )}
        </AdminChartCard>
        <ListPageSection title="Settled volume and refunds">
          {overview.totalsByCurrency.length ? (
            <dl className="divide-y divide-[var(--fm-border)]">
              {overview.totalsByCurrency.map((total) => (
                <div className="grid gap-1 p-4" key={total.currency}>
                  <dt className="font-semibold">{total.currency}</dt>
                  <dd className="text-xl font-semibold">
                    {money(total.succeededMinor, total.currency)}
                  </dd>
                  <dd className="text-xs text-[var(--fm-text-muted)]">
                    {money(total.refundedMinor, total.currency)} refunded
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No settled payment volume.</p>
          )}
        </ListPageSection>
      </AdminDashboardGrid>

      <ListPageSection
        title="Recent transactions"
        description={`${overview.pendingRefundCount} refund request${overview.pendingRefundCount === 1 ? "" : "s"} currently pending.`}
      >
        {overview.recentTransactions.length ? (
          <ul className="divide-y divide-[var(--fm-border)] text-sm">
            {overview.recentTransactions.map((payment) => (
              <li
                className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                key={payment.paymentIntentId}
              >
                <div className="min-w-0">
                  <a
                    className="block truncate font-medium hover:underline"
                    href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                  >
                    {payment.customerEmail}
                  </a>
                  <p className="text-xs text-[var(--fm-text-muted)]">{payment.purpose}</p>
                </div>
                <StatusBadge>{payment.status}</StatusBadge>
                <span className="font-medium">{money(payment.amountMinor, payment.currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No payment intents.</p>
        )}
      </ListPageSection>
    </div>
  );
}
