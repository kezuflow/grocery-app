"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminPaymentPage, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { PaymentNavigation } from "../../../../components/admin/payment-navigation";

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
        <Alert variant="destructive">
          <AlertTitle>Transactions could not be loaded</AlertTitle>
          <AlertDescription>
            {error}
            <br />
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(pagination.cursor, appliedStatus)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!page && !error ? (
        <div role="status">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}
      {page ? (
        <ListPageSection title="Transactions">
          <form
            className="flex gap-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
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
          </form>
          {page.items.length === 0 ? (
            <p className="p-4 text-sm text-[var(--fm-text-muted)]">
              No payment intents match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Refunded</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((payment) => (
                  <TableRow key={payment.paymentIntentId}>
                    <TableCell>{payment.customerEmail}</TableCell>
                    <TableCell>{payment.purpose}</TableCell>
                    <TableCell>
                      <StatusBadge>{payment.status}</StatusBadge>
                    </TableCell>
                    <TableCell>{money(payment.amountMinor, payment.currency)}</TableCell>
                    <TableCell>{money(payment.refundedMinor, payment.currency)}</TableCell>
                    <TableCell>{payment.createdAt.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Link
                        className="font-medium underline"
                        href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
