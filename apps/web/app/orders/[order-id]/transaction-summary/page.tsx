"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProvisionalTransactionSummaryView, RpcResult } from "@freshmarkets/contracts";
import { StorefrontShell } from "../../../../components/storefront/storefront-shell";
import { TransactionSummary } from "../../../../components/storefront/orders/transaction-summary";

export default function TransactionSummaryPage() {
  const orderId = useParams<{ "order-id": string }>()?.["order-id"];
  const [result, setResult] = useState<RpcResult<ProvisionalTransactionSummaryView> | null>(null);
  useEffect(() => {
    if (!orderId) return;
    let active = true;
    void fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}/transaction-summary`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => response.json() as Promise<RpcResult<ProvisionalTransactionSummaryView>>)
      .then((value) => active && setResult(value))
      .catch(
        () =>
          active &&
          setResult({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Transaction summary unavailable",
              requestId: "web",
            },
          }),
      );
    return () => {
      active = false;
    };
  }, [orderId]);

  return (
    <StorefrontShell>
      {!result ? (
        <p role="status" className="p-8">
          Loading transaction summary…
        </p>
      ) : result.ok ? (
        <>
          <nav className="transaction-summary-actions px-5 pt-6">
            <Link
              href={`/orders/${encodeURIComponent(orderId ?? "")}`}
              className="font-semibold underline"
            >
              Back to order
            </Link>
          </nav>
          <TransactionSummary summary={result.value} />
        </>
      ) : (
        <div role="alert" className="p-8">
          <h1 className="text-2xl font-bold">
            {result.error.code === "NOT_FOUND"
              ? "Transaction summary not found"
              : "Transaction summary unavailable"}
          </h1>
          <p className="mt-2">{result.error.message}</p>
        </div>
      )}
    </StorefrontShell>
  );
}
