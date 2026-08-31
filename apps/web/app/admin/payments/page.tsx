"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminPaymentOverview, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { PageHeader } from "../../../components/admin/admin-shell";
import { PaymentNavigation } from "../../../components/admin/payment-navigation";
import { PaymentOverviewView } from "../../../components/admin/payment-overview-view";

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
      {overview ? <PaymentOverviewView overview={overview} /> : null}
    </div>
  );
}
