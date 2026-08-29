"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminPaymentPage, AdminPaymentSummary, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import {
  AdminCursorPagination,
  FilterBar,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { PaymentNavigation } from "../../../../components/admin/payment-navigation";
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from "../../../../components/admin/admin-data-table";
import { AdminPageState } from "../../../../components/admin/admin-page-state";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export default function PaymentTransactionsPage() {
  const [page, setPage] = useState<AdminPaymentPage | null>(null);
  const [status, setStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pagination = useAdminPagination();
  const load = useCallback(async (cursor: string | null, filter: string) => {
    setError(null);
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    if (filter) query.set("status", filter);
    try {
      const payload = (await (
        await fetch(`/api/admin/payments?${query}`)
      ).json()) as RpcResult<AdminPaymentPage>;
      if (!payload.ok) return setError(payload.error.message);
      setPage(payload.value);
    } catch {
      setError("Network error loading payment transactions.");
    }
  }, []);
  useEffect(() => {
    void load(pagination.cursor, appliedStatus);
  }, [appliedStatus, load, pagination.cursor]);
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Payment transactions"
        description="Search canonical intent outcomes and open a transaction workspace."
      />
      <PaymentNavigation />
      {error ? (
        <AdminPageState
          state="error"
          title="Transactions could not be loaded"
          message={error}
          onRetry={() => void load(pagination.cursor, appliedStatus)}
        />
      ) : null}
      {!page && !error ? (
        <AdminPageState state="loading" title="Loading payment transactions" />
      ) : null}
      {page ? (
        <ListPageSection title="Transactions">
          <FilterBar
            label="Payment filters"
            onSubmit={() => {
              setAppliedStatus(status.trim().toUpperCase());
              pagination.reset();
            }}
          >
            <Input
              aria-label="Payment status"
              placeholder="status (optional)"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="sm:w-56"
            />
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </FilterBar>
          {page.items.length === 0 ? (
            <div className="p-4">
              <AdminPageState
                state={appliedStatus ? "filtered-empty" : "empty"}
                message="No payment intents are visible."
              />
            </div>
          ) : (
            <AdminDataTable<AdminPaymentSummary>
              ariaLabel="Payment transactions"
              rows={page.items}
              rowKey={(payment) => payment.paymentIntentId}
              columns={
                [
                  {
                    key: "customer",
                    header: "Customer",
                    render: (payment) => payment.customerEmail,
                  },
                  { key: "purpose", header: "Purpose", render: (payment) => payment.purpose },
                  {
                    key: "status",
                    header: "Status",
                    render: (payment) => <StatusBadge>{payment.status}</StatusBadge>,
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    render: (payment) => money(payment.amountMinor, payment.currency),
                  },
                  {
                    key: "refunded",
                    header: "Refunded",
                    render: (payment) => money(payment.refundedMinor, payment.currency),
                  },
                  {
                    key: "created",
                    header: "Created",
                    render: (payment) => payment.createdAt.slice(0, 10),
                  },
                  {
                    key: "open",
                    header: "Actions",
                    render: (payment) => (
                      <Link
                        className="font-medium underline"
                        href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                      >
                        Open
                      </Link>
                    ),
                  },
                ] satisfies ReadonlyArray<AdminDataTableColumn<AdminPaymentSummary>>
              }
            />
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </ListPageSection>
      ) : null}
    </div>
  );
}
