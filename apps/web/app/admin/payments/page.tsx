"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminPaymentPage, AdminReconciliationPage, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<AdminPaymentPage | null>(null);
  const [cases, setCases] = useState<AdminReconciliationPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reason, setReason] = useState("");
  const [refundIntent, setRefundIntent] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [confirmingRefund, setConfirmingRefund] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const paymentPagination = useAdminPagination();
  const reconciliationPagination = useAdminPagination();
  const resolveIntent = useAdminCommandIntent();
  const refundCommand = useAdminCommandIntent();
  const load = useCallback(async (paymentCursor: string | null, caseCursor: string | null) => {
    setState("loading");
    try {
      const [paymentsResponse, casesResponse] = await Promise.all([
        fetch(
          `/api/admin/payments?limit=50${paymentCursor ? `&cursor=${encodeURIComponent(paymentCursor)}` : ""}`,
        ),
        fetch(
          `/api/admin/payments/reconciliation?status=OPEN&limit=50${caseCursor ? `&cursor=${encodeURIComponent(caseCursor)}` : ""}`,
        ),
      ]);
      const paymentPayload = (await paymentsResponse.json()) as RpcResult<AdminPaymentPage>;
      const casePayload = (await casesResponse.json()) as RpcResult<AdminReconciliationPage>;
      if (!paymentPayload.ok) {
        setNotice(paymentPayload.error.message);
        setState("error");
        return;
      }
      if (!casePayload.ok) {
        setNotice(casePayload.error.message);
        setState("error");
        return;
      }
      setPayments(paymentPayload.value);
      setCases(casePayload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading payments.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load(paymentPagination.cursor, reconciliationPagination.cursor);
  }, [load, paymentPagination.cursor, reconciliationPagination.cursor]);
  async function resolve(caseId: string) {
    if (!reason.trim()) {
      setNotice("A resolution reason is required.");
      return;
    }
    let payload: RpcResult<unknown>;
    try {
      payload = await resolveIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/payments/reconciliation/${encodeURIComponent(caseId)}/resolve`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({ reason: reason.trim() }),
          },
        );
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry to safely reuse the reconciliation request.");
      return;
    }
    setNotice(payload.ok ? "Reconciliation case resolved." : payload.error.message);
    if (payload.ok) {
      setReason("");
      await load(paymentPagination.cursor, reconciliationPagination.cursor);
    }
  }
  async function requestRefund(confirmedReason: string) {
    const amountMinor = Math.round(Number(refundAmount) * 100);
    if (!refundIntent.trim() || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      setNotice("Payment intent, positive amount, and refund reason are required.");
      return;
    }
    let payload: RpcResult<unknown>;
    try {
      payload = await refundCommand.submit(async (idempotencyKey) => {
        const response = await fetch("/api/admin/payments/refunds", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            paymentIntentId: refundIntent.trim(),
            amountMinor,
            reason: confirmedReason,
          }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry confirmation to safely reuse the refund request.");
      return;
    }
    setNotice(payload.ok ? "Refund request recorded." : payload.error.message);
    if (payload.ok) {
      setRefundIntent("");
      setRefundAmount("");
      setConfirmingRefund(false);
      await load(paymentPagination.cursor, reconciliationPagination.cursor);
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Payments"
        description="Payment intents, refund requests, and reconciliation exceptions."
      />
      {state === "loading" ? (
        <div role="status">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Payments could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <br />
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(paymentPagination.cursor, reconciliationPagination.cursor)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && payments && cases ? (
        <>
          <ListPageSection title="Payment intents">
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {payments.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">No payment intents.</p>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.items.map((payment) => (
                    <TableRow key={payment.paymentIntentId}>
                      <TableCell>{payment.customerEmail}</TableCell>
                      <TableCell>{payment.purpose}</TableCell>
                      <TableCell>
                        <StatusBadge>{payment.status}</StatusBadge>
                      </TableCell>
                      <TableCell>
                        {payment.currency} {(payment.amountMinor / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {payment.currency} {(payment.refundedMinor / 100).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs">{payment.createdAt.slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <AdminCursorPagination
              pageNumber={paymentPagination.pageNumber}
              nextCursor={payments.nextCursor}
              onPrevious={paymentPagination.previous}
              onNext={paymentPagination.next}
            />
          </ListPageSection>
          <ListPageSection
            title="Open reconciliation cases"
            description="Resolve only after the provider discrepancy is understood."
          >
            <div className="p-4">
              <Input
                aria-label="Resolution reason"
                placeholder="resolution reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {cases.items.length === 0 ? (
              <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]">No open cases.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Payment intent</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.items.map((item) => (
                    <TableRow key={item.caseId}>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.paymentIntentId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{item.createdAt.slice(0, 10)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={resolveIntent.pending}
                          onClick={() => void resolve(item.caseId)}
                        >
                          Resolve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <AdminCursorPagination
              pageNumber={reconciliationPagination.pageNumber}
              nextCursor={cases.nextCursor}
              onPrevious={reconciliationPagination.previous}
              onNext={reconciliationPagination.next}
            />
          </ListPageSection>
          <ListPageSection
            title="Request a refund"
            description="Creates a REQUESTED refund; provider confirmation determines the outcome."
          >
            <div className="grid gap-2 p-4 sm:grid-cols-3">
              <Input
                aria-label="Payment intent"
                placeholder="payment intent id"
                value={refundIntent}
                onChange={(event) => setRefundIntent(event.target.value)}
              />
              <Input
                aria-label="Refund amount"
                placeholder="amount (PHP)"
                inputMode="decimal"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
              />
            </div>
            <div className="px-4 pb-4">
              <Button
                variant="destructive"
                disabled={refundCommand.pending}
                onClick={() => {
                  const amountMinor = Math.round(Number(refundAmount) * 100);
                  if (!refundIntent.trim() || !Number.isInteger(amountMinor) || amountMinor <= 0) {
                    setNotice("Payment intent and a positive amount are required.");
                    return;
                  }
                  setConfirmingRefund(true);
                }}
              >
                Request refund
              </Button>
            </div>
          </ListPageSection>
          <AdminConfirmationDialog
            open={confirmingRefund}
            title="Confirm refund request"
            resource={`${refundIntent || "Payment intent"} · PHP ${refundAmount || "0"}`}
            scope="Core-authorized payment scope"
            consequence="This creates a financial refund request; provider confirmation determines the canonical outcome."
            pending={refundCommand.pending}
            onCancel={() => setConfirmingRefund(false)}
            onConfirm={(confirmedReason) => void requestRefund(confirmedReason)}
          />
        </>
      ) : null}
    </div>
  );
}
