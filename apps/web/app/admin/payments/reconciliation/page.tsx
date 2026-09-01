"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminReconciliationCaseView,
  AdminReconciliationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
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
  ConfirmCommandDialog,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { PaymentNavigation } from "../../../../components/admin/payment-navigation";

export default function PaymentReconciliationPage() {
  const [page, setPage] = useState<AdminReconciliationPage | null>(null);
  const [selectedCase, setSelectedCase] = useState<AdminReconciliationCaseView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pagination = useAdminPagination();
  const command = useAdminCommandIntent();
  const load = useCallback(async (cursor: string | null) => {
    try {
      const payload = (await (
        await fetch(
          `/api/admin/payments/reconciliation?status=OPEN&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        )
      ).json()) as RpcResult<AdminReconciliationPage>;
      if (!payload.ok) return setNotice(payload.error.message);
      setPage(payload.value);
    } catch {
      setNotice("Network error loading reconciliation cases.");
    }
  }, []);
  useEffect(() => {
    void load(pagination.cursor);
  }, [load, pagination.cursor]);
  async function resolve(item: AdminReconciliationCaseView, reason: string) {
    try {
      const result = await command.submit(
        async (idempotencyKey) =>
          (await (
            await fetch(
              `/api/admin/payments/reconciliation/${encodeURIComponent(item.caseId)}/resolve`,
              {
                method: "POST",
                headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
                body: JSON.stringify({ reason: reason.trim() }),
              },
            )
          ).json()) as RpcResult<unknown>,
      );
      setNotice(result.ok ? "Reconciliation case resolved." : result.error.message);
      if (result.ok) {
        await load(pagination.cursor);
      }
    } catch {
      setNotice("Connection lost. Retry to safely reuse the reconciliation request.");
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Payment reconciliation"
        description="Investigate canonical exceptions before recording an explicit resolution."
      />
      <PaymentNavigation />
      {notice ? (
        <Alert>
          <AlertTitle>Reconciliation status</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {!page ? (
        <div role="status">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <ListPageSection title="Open cases">
          {page.items.length === 0 ? (
            <p className="p-4 text-sm text-[var(--fm-text-muted)]">No open reconciliation cases.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((item) => (
                  <TableRow key={item.caseId}>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>
                      {item.paymentIntentId ? (
                        <Link
                          className="font-mono text-xs underline"
                          href={`/admin/payments/transactions/${item.paymentIntentId}`}
                          prefetch={false}
                        >
                          {item.paymentIntentId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge>{item.status}</StatusBadge>
                    </TableCell>
                    <TableCell>{item.createdAt.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={command.pending}
                        onClick={() => setSelectedCase(item)}
                      >
                        Review resolution
                      </Button>
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
      )}
      <ConfirmCommandDialog
        open={selectedCase !== null}
        title="Resolve reconciliation case?"
        resource={`${selectedCase?.category ?? "Payment reconciliation"} · ${selectedCase?.caseId ?? ""}`}
        scope={selectedCase?.paymentIntentId ?? "No linked payment intent"}
        consequence="This records the exception as resolved with an immutable audit event. It does not alter provider payment state."
        confirmLabel="Confirm resolution"
        pending={command.pending}
        onCancel={() => setSelectedCase(null)}
        onConfirm={(reason) => {
          const item = selectedCase;
          setSelectedCase(null);
          if (item) void resolve(item, reason);
        }}
      />
    </div>
  );
}
