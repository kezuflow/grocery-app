"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminPaymentOverview, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { PaymentNavigation } from "../../../components/admin/payment-navigation";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export default function PaymentsOverviewPage() {
  const [overview, setOverview] = useState<AdminPaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = (await (
        await fetch("/api/admin/payments/overview")
      ).json()) as RpcResult<AdminPaymentOverview>;
      if (!payload.ok) return setError(payload.error.message);
      setOverview(payload.value);
    } catch {
      setError("Network error loading the payment overview.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Payments"
        description="Canonical payment outcomes, refund exposure, and reconciliation workload."
      />
      <PaymentNavigation />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Payments could not be loaded</AlertTitle>
          <AlertDescription>
            {error}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!overview && !error ? (
        <div role="status" aria-label="Loading payment overview">
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}
      {overview ? (
        <>
          <section
            aria-label="Payment metrics"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {Object.entries(overview.intentCounts).map(([label, value]) => (
              <div className="rounded-[var(--fm-radius-panel)] border bg-white p-4" key={label}>
                <p className="text-xs uppercase text-[var(--fm-text-muted)]">
                  {label.replace(/([A-Z])/g, " $1")}
                </p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </section>
          {overview.openReconciliationCount > 0 ? (
            <Alert>
              <AlertTitle>Reconciliation attention</AlertTitle>
              <AlertDescription>
                {overview.openReconciliationCount} open case
                {overview.openReconciliationCount === 1 ? "" : "s"}.{" "}
                <Link className="underline" href="/admin/payments/reconciliation">
                  Open queue
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <ListPageSection title="Settled volume and refunds">
            {overview.totalsByCurrency.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No settled payment volume.</p>
            ) : (
              <dl className="grid gap-4 p-4 sm:grid-cols-3">
                {overview.totalsByCurrency.map((total) => (
                  <div key={total.currency}>
                    <dt className="font-medium">{total.currency}</dt>
                    <dd>{money(total.succeededMinor, total.currency)} succeeded</dd>
                    <dd className="text-[var(--fm-text-muted)]">
                      {money(total.refundedMinor, total.currency)} refunded
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </ListPageSection>
          <ListPageSection
            title="Recent transactions"
            description={`${overview.pendingRefundCount} refund request${overview.pendingRefundCount === 1 ? "" : "s"} currently pending.`}
          >
            {overview.recentTransactions.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No payment intents.</p>
            ) : (
              <ul className="divide-y text-sm">
                {overview.recentTransactions.map((payment) => (
                  <li
                    className="flex flex-wrap justify-between gap-3 p-4"
                    key={payment.paymentIntentId}
                  >
                    <div>
                      <Link
                        className="font-medium underline"
                        href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                      >
                        {payment.customerEmail}
                      </Link>
                      <p className="text-xs text-[var(--fm-text-muted)]">{payment.purpose}</p>
                    </div>
                    <div className="text-right">
                      <StatusBadge>{payment.status}</StatusBadge>
                      <p>{money(payment.amountMinor, payment.currency)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
