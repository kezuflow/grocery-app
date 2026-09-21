"use client";

import type {
  AdminPaymentAttentionItem,
  AdminPaymentAttentionPage,
  AdminPaymentDetail,
  AdminPaymentPage,
  AdminPaymentSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminCommandIntent } from "./admin-command-state";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "./admin-controls";
import { AdminMasterDetailWorkspace } from "./admin-master-detail-workspace";
import { AdminPageState } from "./admin-page-state";
import { PageHeader, StatusBadge } from "./admin-shell";
import { PaymentRecovery } from "./payment-recovery";
import { RefundRecovery } from "./refund-recovery";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { refundAmountMinor, refundResponse } from "@/lib/refund-response";

type Tab = "payments" | "attention";
type StatusFilter = "all" | "paid" | "partially-refunded" | "refunded";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}
function date(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(value));
}
function statusLabel(status: string) {
  return status === "SUCCEEDED" ? "Paid" : status.replaceAll("_", " ").toLowerCase();
}
function displayLabel(status: AdminPaymentDetail["displayStatus"]) {
  const labels: Record<AdminPaymentDetail["displayStatus"], string> = {
    AWAITING_PAYMENT: "Awaiting payment",
    PAYMENT_WINDOW_EXPIRED: "Payment window expired",
    CONFIRMING_PAYMENT: "Confirming payment",
    PAID: "Paid",
    PARTIALLY_REFUNDED: "Partially refunded",
    REFUNDED: "Refunded",
    PAYMENT_FAILED: "Payment failed",
    PAYMENT_OUTCOME_UNKNOWN: "Payment outcome unknown",
  };
  return labels[status];
}

export function PaymentsWorkspace({
  initialTab,
  initialStatus,
  initialPayments,
  initialAttention,
  initialDetail,
  initialIssue,
}: {
  initialTab: Tab;
  initialStatus: string;
  initialPayments: RpcResult<AdminPaymentPage>;
  initialAttention: RpcResult<AdminPaymentAttentionPage>;
  initialDetail: RpcResult<AdminPaymentDetail> | null;
  initialIssue: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<StatusFilter>(
    ["paid", "partially-refunded", "refunded"].includes(initialStatus)
      ? (initialStatus as StatusFilter)
      : "all",
  );
  const [payments, setPayments] = useState(initialPayments.ok ? initialPayments.value : null);
  const [attention, setAttention] = useState(initialAttention.ok ? initialAttention.value : null);
  const [detail, setDetail] = useState(initialDetail?.ok ? initialDetail.value : null);
  const [selectedIssue, setSelectedIssue] = useState(initialIssue);
  const [error, setError] = useState<string | null>(
    !initialPayments.ok
      ? initialPayments.error.message
      : !initialAttention.ok
        ? initialAttention.error.message
        : initialDetail && !initialDetail.ok
          ? initialDetail.error.message
          : null,
  );
  const [loading, setLoading] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<{
    url: string;
    body: string;
    key: string;
    successMessage: string;
  } | null>(null);
  const paymentPages = useAdminPagination(status);
  const attentionPages = useAdminPagination("attention");
  const requestSerial = useRef(0);
  const command = useAdminCommandIntent();
  const locked = unresolved !== null || command.pending;

  const replaceUrl = useCallback(
    (next: {
      tab?: Tab;
      status?: StatusFilter;
      cursor?: string | null;
      payment?: string | null;
      issue?: string | null;
    }) => {
      const params = new URLSearchParams(window.location.search);
      const nextTab = next.tab ?? tab;
      if (nextTab === "attention") params.set("tab", "attention");
      else params.delete("tab");
      const nextStatus = next.status ?? status;
      if (nextStatus === "all") params.delete("status");
      else params.set("status", nextStatus);
      if (next.cursor) params.set("cursor", next.cursor);
      else params.delete("cursor");
      if (next.payment) {
        params.set("payment", next.payment);
        params.delete("issue");
      } else if (next.payment === null) params.delete("payment");
      if (next.issue) {
        params.set("issue", next.issue);
        params.delete("payment");
      } else if (next.issue === null) params.delete("issue");
      window.history.pushState(null, "", `/admin/payments${params.size ? `?${params}` : ""}`);
    },
    [status, tab],
  );

  const loadPayments = useCallback(async (nextStatus: StatusFilter, cursor: string | null) => {
    const serial = ++requestSerial.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: "50" });
    const coreStatus =
      nextStatus === "paid"
        ? "SUCCEEDED"
        : nextStatus === "partially-refunded"
          ? "PARTIALLY_REFUNDED"
          : nextStatus === "refunded"
            ? "REFUNDED"
            : null;
    if (coreStatus) query.set("status", coreStatus);
    if (cursor) query.set("cursor", cursor);
    try {
      const payload = (await (
        await fetch(`/api/admin/payments?${query}`)
      ).json()) as RpcResult<AdminPaymentPage>;
      if (serial !== requestSerial.current) return;
      if (!payload.ok) setError(payload.error.message);
      else setPayments(payload.value);
    } catch {
      if (serial === requestSerial.current) setError("Network error loading payments.");
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }, []);

  const loadAttention = useCallback(async (cursor: string | null) => {
    const serial = ++requestSerial.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    try {
      const payload = (await (
        await fetch(`/api/admin/payments/attention?${query}`)
      ).json()) as RpcResult<AdminPaymentAttentionPage>;
      if (serial !== requestSerial.current) return;
      if (!payload.ok) setError(payload.error.message);
      else setAttention(payload.value);
    } catch {
      if (serial === requestSerial.current) setError("Network error loading payment issues.");
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (paymentIntentId: string) => {
    const serial = ++requestSerial.current;
    setError(null);
    try {
      const payload = (await (
        await fetch(`/api/admin/payments/${encodeURIComponent(paymentIntentId)}`)
      ).json()) as RpcResult<AdminPaymentDetail>;
      if (serial !== requestSerial.current) return;
      if (!payload.ok) setError(payload.error.message);
      else setDetail(payload.value);
    } catch {
      if (serial === requestSerial.current) setError("Network error loading this payment.");
    }
  }, []);

  useEffect(() => {
    const restore = () => {
      if (locked) return;
      const params = new URLSearchParams(window.location.search);
      const restoredTab = params.get("tab") === "attention" ? "attention" : "payments";
      const restoredStatus = ["paid", "partially-refunded", "refunded"].includes(
        params.get("status") ?? "",
      )
        ? (params.get("status") as StatusFilter)
        : "all";
      setTab(restoredTab);
      setStatus(restoredStatus);
      setSelectedIssue(params.get("issue"));
      const paymentId = params.get("payment");
      if (paymentId) void loadDetail(paymentId);
      else setDetail(null);
      if (restoredTab === "attention") void loadAttention(params.get("cursor"));
      else void loadPayments(restoredStatus, params.get("cursor"));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [loadAttention, loadDetail, loadPayments, locked]);

  async function refresh() {
    if (tab === "attention") await loadAttention(attentionPages.cursor);
    else await loadPayments(status, paymentPages.cursor);
    if (detail) await loadDetail(detail.paymentIntentId);
  }
  function choosePayment(paymentIntentId: string) {
    if (locked) return;
    setSelectedIssue(null);
    replaceUrl({ payment: paymentIntentId, issue: null });
    void loadDetail(paymentIntentId);
  }
  function chooseIssue(item: AdminPaymentAttentionItem) {
    if (locked) return;
    setDetail(null);
    setSelectedIssue(item.groupKey);
    replaceUrl({ issue: item.groupKey, payment: null });
  }
  function changeTab(next: Tab) {
    if (locked || next === tab) return;
    setTab(next);
    setDetail(null);
    setSelectedIssue(null);
    replaceUrl({ tab: next, cursor: null, payment: null, issue: null });
    if (next === "attention") void loadAttention(null);
    else void loadPayments(status, null);
  }
  async function sendSaved(
    url: string,
    body: string,
    key: string,
    successMessage = "Recovery queued. The issue remains visible while it is checked automatically.",
  ) {
    setUnresolved({ url, body, key, successMessage });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body,
      });
      const payload = (await response.json()) as { ok?: boolean; error?: { message?: string } };
      if (typeof payload.ok !== "boolean") throw new Error("Unknown response");
      setUnresolved(null);
      setNotice(payload.ok ? successMessage : (payload.error?.message ?? "Recovery was rejected."));
      await refresh();
    } catch {
      setNotice("The response is unknown. Retry the saved command to recover the original result.");
    }
  }
  async function submitRefund(reason: string) {
    if (!detail) return;
    const amountMinor = refundAmountMinor(refundAmount);
    if (amountMinor === null || amountMinor > detail.remainingRefundableMinor) {
      setNotice("Enter a valid amount within the remaining refundable balance.");
      setConfirmRefund(false);
      return;
    }
    const body = JSON.stringify({
      paymentIntentId: detail.paymentIntentId,
      amountMinor,
      expectedVersion: detail.version,
      reason,
    });
    const key = command.idempotencyKey;
    const successMessage = "Refund request accepted. Provider progress is shown below.";
    setUnresolved({ url: "/api/admin/payments/refunds", body, key, successMessage });
    setConfirmRefund(false);
    try {
      const result = await command.submit(async (idempotencyKey) =>
        refundResponse.parse(
          await (
            await fetch("/api/admin/payments/refunds", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body,
            })
          ).json(),
        ),
      );
      setUnresolved(null);
      setNotice(
        result.ok
          ? "Refund request accepted. Provider progress is shown below."
          : result.error.message,
      );
      if (result.ok) setRefundAmount("");
      await loadDetail(detail.paymentIntentId);
    } catch {
      setNotice("The response is unknown. Retry the saved refund request to recover its result.");
    }
  }

  const selectedAttention =
    attention?.items.find((item) => item.groupKey === selectedIssue) ?? null;
  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader title="Payments" />
      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <div
          className="flex min-h-14 items-end gap-1 border-b border-[var(--fm-border)] px-3 pt-2"
          role="tablist"
          aria-label="Payment views"
        >
          <button
            role="tab"
            aria-selected={tab === "payments"}
            className={`border-b-2 px-3 py-3 text-sm font-medium ${tab === "payments" ? "border-[var(--fm-text)]" : "border-transparent text-[var(--fm-text-muted)]"}`}
            onClick={() => changeTab("payments")}
          >
            Payments
          </button>
          <button
            role="tab"
            aria-selected={tab === "attention"}
            className={`border-b-2 px-3 py-3 text-sm font-medium ${tab === "attention" ? "border-[var(--fm-text)]" : "border-transparent text-[var(--fm-text-muted)]"}`}
            onClick={() => changeTab("attention")}
          >
            Needs attention{attention && attention.total > 0 ? ` (${attention.total})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--fm-border)] p-3">
          {tab === "payments" ? (
            <label className="grid gap-1 text-sm">
              <span>Status</span>
              <select
                className="h-9 rounded-md border border-[var(--fm-border)] bg-transparent px-3"
                value={status}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.value as StatusFilter;
                  setStatus(next);
                  paymentPages.reset();
                  replaceUrl({ status: next, cursor: null });
                  void loadPayments(next, null);
                }}
              >
                <option value="all">All payments</option>
                <option value="paid">Paid</option>
                <option value="partially-refunded">Partially refunded</option>
                <option value="refunded">Refunded</option>
              </select>
            </label>
          ) : (
            <span className="text-sm text-[var(--fm-text-muted)]">
              Genuine unresolved payment and refund issues
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={locked || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>
        {error ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Payments could not be loaded"
              message={error}
              onRetry={() => void refresh()}
            />
          </div>
        ) : null}
        {loading && !error ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading payments" />
          </div>
        ) : null}
        {!loading && !error && tab === "payments" && payments?.items.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={status === "all" ? "empty" : "filtered-empty"}
              message={
                status === "all" ? "No payments received yet" : "No payments match this filter"
              }
            />
          </div>
        ) : null}
        {!loading && !error && tab === "attention" && attention?.items.length === 0 ? (
          <div className="p-4">
            <AdminPageState state="empty" message="No payments need attention" />
          </div>
        ) : null}
        {!loading && !error && tab === "payments" && payments?.items.length ? (
          <Table aria-label="Payments">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Refunded</TableHead>
                <TableHead>Date created</TableHead>
                <TableHead>
                  <span className="sr-only">View</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.items.map((payment: AdminPaymentSummary) => (
                <TableRow
                  key={payment.paymentIntentId}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => choosePayment(payment.paymentIntentId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choosePayment(payment.paymentIntentId);
                    }
                  }}
                >
                  <TableCell>
                    <span className="font-medium">
                      {payment.customerName ?? payment.customerEmail}
                    </span>
                    {payment.customerName && payment.customerEmail !== "Deleted customer" ? (
                      <span className="block text-xs text-[var(--fm-text-muted)]">
                        {payment.customerEmail}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {payment.orderId ? (
                      <Link
                        className="underline"
                        href={`/admin/orders/${payment.orderId}`}
                        prefetch={false}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {payment.orderNumber ?? payment.orderId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge>{statusLabel(payment.status)}</StatusBadge>
                  </TableCell>
                  <TableCell>{money(payment.amountMinor, payment.currency)}</TableCell>
                  <TableCell>{money(payment.refundedMinor, payment.currency)}</TableCell>
                  <TableCell>{date(payment.createdAt)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        choosePayment(payment.paymentIntentId);
                      }}
                    >
                      View payment
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {!loading && !error && tab === "attention" && attention?.items.length ? (
          <Table aria-label="Payments needing attention">
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attention.items.map((item) => (
                <TableRow
                  key={item.groupKey}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => chooseIssue(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseIssue(item);
                    }
                  }}
                >
                  <TableCell>
                    {item.customerName ??
                      item.customerEmail ??
                      (item.paymentIntentId ? "Payment" : "Unmatched payment")}
                  </TableCell>
                  <TableCell>
                    {item.problem}
                    {item.state === "CHECKING_AUTOMATICALLY" ? (
                      <span className="block text-xs text-[var(--fm-text-muted)]">
                        Checking automatically
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {item.amountMinor === null || !item.currency
                      ? "Unavailable"
                      : money(item.amountMinor, item.currency)}
                  </TableCell>
                  <TableCell>{date(item.openedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {tab === "payments" && payments ? (
          <AdminCursorPagination
            pageNumber={paymentPages.pageNumber}
            nextCursor={payments.nextCursor}
            onPrevious={() => {
              paymentPages.previous();
              replaceUrl({ cursor: paymentPages.previousCursor });
              void loadPayments(status, paymentPages.previousCursor);
            }}
            onNext={(cursor) => {
              paymentPages.next(cursor);
              replaceUrl({ cursor });
              void loadPayments(status, cursor);
            }}
          />
        ) : null}
        {tab === "attention" && attention ? (
          <AdminCursorPagination
            pageNumber={attentionPages.pageNumber}
            nextCursor={attention.nextCursor}
            onPrevious={() => {
              attentionPages.previous();
              replaceUrl({ cursor: attentionPages.previousCursor });
              void loadAttention(attentionPages.previousCursor);
            }}
            onNext={(cursor) => {
              attentionPages.next(cursor);
              replaceUrl({ cursor });
              void loadAttention(cursor);
            }}
          />
        ) : null}
      </section>
    </section>
  );

  const detailPanel = detail ? (
    <PaymentPanel
      payment={detail}
      locked={locked}
      notice={notice}
      refundAmount={refundAmount}
      setRefundAmount={setRefundAmount}
      onClose={() => {
        if (!locked) {
          setDetail(null);
          replaceUrl({ payment: null });
        }
      }}
      onRefresh={() => loadDetail(detail.paymentIntentId)}
      onRefund={() => setConfirmRefund(true)}
    />
  ) : selectedAttention ? (
    <IssuePanel
      item={selectedAttention}
      locked={locked}
      notice={notice}
      onViewPayment={
        selectedAttention.paymentIntentId
          ? () => choosePayment(selectedAttention.paymentIntentId!)
          : undefined
      }
      onClose={() => {
        if (!locked) {
          setSelectedIssue(null);
          replaceUrl({ issue: null });
        }
      }}
      onRun={(url, body) => void sendSaved(url, body, crypto.randomUUID())}
    />
  ) : null;
  return (
    <>
      <AdminMasterDetailWorkspace
        open={detailPanel !== null}
        master={master}
        detail={detailPanel}
        panelId="payment-detail-panel"
        labelledBy="payment-panel-title"
        resizeLabel="Resize payment details"
      />
      <AdminConfirmationDialog
        open={confirmRefund}
        title="Confirm refund request"
        resource={
          detail
            ? `Payment ${detail.paymentIntentId} · ${detail.currency} ${refundAmount || "0"}`
            : "Payment"
        }
        scope="Core-authorized global payment scope"
        consequence="This creates a financial refund request. Provider confirmation determines the canonical outcome."
        pending={command.pending}
        onCancel={() => setConfirmRefund(false)}
        onConfirm={(reason) => void submitRefund(reason)}
      />
      {unresolved ? (
        <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-[var(--fm-admin-surface)] p-3 shadow-lg">
          <span className="text-sm">Command response unknown.</span>
          <Button
            size="sm"
            onClick={() =>
              void sendSaved(
                unresolved.url,
                unresolved.body,
                unresolved.key,
                unresolved.successMessage,
              )
            }
          >
            Retry saved command
          </Button>
        </div>
      ) : null}
    </>
  );
}

function PaymentPanel({
  payment,
  locked,
  notice,
  refundAmount,
  setRefundAmount,
  onClose,
  onRefresh,
  onRefund,
}: {
  payment: AdminPaymentDetail;
  locked: boolean;
  notice: string | null;
  refundAmount: string;
  setRefundAmount: (value: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRefund: () => void;
}) {
  const received = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
    payment.canonicalStatus,
  );
  const technical =
    payment.attempts.length +
      payment.events.length +
      payment.reactions.length +
      payment.reconciliationCases.length +
      payment.recentAudit.length >
    0;
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Payment
          </p>
          <h2 id="payment-panel-title" className="mt-1 truncate text-xl font-bold">
            {payment.orderNumber ?? payment.paymentIntentId}
          </h2>
          <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
            {payment.customerName ?? payment.customerEmail}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          aria-label="Close payment details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <StatusBadge>{displayLabel(payment.displayStatus)}</StatusBadge>
        {payment.displayStatus === "PAYMENT_OUTCOME_UNKNOWN" ? (
          <p className="text-sm">
            The provider outcome could not be verified after bounded automatic recovery.
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        <dl className="divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
          {[
            [received ? "Amount received" : "Amount", money(payment.amountMinor, payment.currency)],
            ["Refunded", money(payment.refundedMinor, payment.currency)],
            ...(payment.refunds.some((refund) =>
              ["REQUESTED", "APPROVED", "PROCESSING", "ESCALATED"].includes(refund.status),
            )
              ? [
                  [
                    "Pending refunds",
                    money(
                      payment.refunds
                        .filter((refund) =>
                          ["REQUESTED", "APPROVED", "PROCESSING", "ESCALATED"].includes(
                            refund.status,
                          ),
                        )
                        .reduce((sum, refund) => sum + refund.amountMinor, 0),
                      payment.currency,
                    ),
                  ],
                ]
              : []),
            ["Date created", date(payment.createdAt)],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-4 px-3 py-3 text-sm">
              <dt className="text-[var(--fm-text-muted)]">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {payment.orderId ? (
          <Link
            className="text-sm font-medium underline"
            href={`/admin/orders/${payment.orderId}`}
            prefetch={false}
          >
            View Order {payment.orderNumber ?? payment.orderId}
          </Link>
        ) : null}
        <PaymentRecovery payment={payment} onAccepted={onRefresh} />
        {payment.refunds.map((refund) => (
          <div key={refund.refundId} className="rounded-lg border p-3 text-sm">
            <div className="flex justify-between">
              <span>{money(refund.amountMinor, refund.currency)}</span>
              <StatusBadge>{refund.status}</StatusBadge>
            </div>
            <RefundRecovery refund={refund} onAccepted={onRefresh} />
          </div>
        ))}
        {payment.allowedActions.includes("REQUEST_REFUND") ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Refund payment</p>
            <p className="text-xs text-[var(--fm-text-muted)]">
              Remaining refundable amount:{" "}
              {money(payment.remainingRefundableMinor, payment.currency)}
            </p>
            <div className="flex gap-2">
              <Input
                aria-label="Refund amount"
                inputMode="decimal"
                value={refundAmount}
                disabled={locked}
                onChange={(event) => setRefundAmount(event.target.value)}
              />
              <Button variant="destructive" disabled={locked} onClick={onRefund}>
                Refund
              </Button>
            </div>
          </div>
        ) : payment.refundUnavailableReason ? (
          <p className="text-sm text-[var(--fm-text-muted)]">{payment.refundUnavailableReason}</p>
        ) : null}
        {technical ? (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
            <div className="mt-3 space-y-4 break-all text-xs text-[var(--fm-text-muted)]">
              <p>
                Payment ID: {payment.paymentIntentId} · Canonical state: {payment.canonicalStatus} ·
                Version: {payment.version}
              </p>
              {payment.attempts.length ? (
                <section>
                  <h3 className="font-semibold text-[var(--fm-text)]">Attempts</h3>
                  {payment.attempts.map((item) => (
                    <p key={item.attemptId}>
                      {item.provider} · {item.status} · {item.attemptId}
                    </p>
                  ))}
                </section>
              ) : null}
              {payment.events.length ? (
                <section>
                  <h3 className="font-semibold text-[var(--fm-text)]">Provider events</h3>
                  {payment.events.map((item) => (
                    <p key={item.eventId}>
                      {item.eventType} · {item.processingStatus}
                    </p>
                  ))}
                </section>
              ) : null}
              {payment.reactions.length ? (
                <section>
                  <h3 className="font-semibold text-[var(--fm-text)]">Order reactions</h3>
                  {payment.reactions.map((item) => (
                    <p key={item.reactionId}>
                      {item.reactionType} · {item.status} · attempts {item.attempts}
                    </p>
                  ))}
                </section>
              ) : null}
              {payment.reconciliationCases.length ? (
                <section>
                  <h3 className="font-semibold text-[var(--fm-text)]">Issue history</h3>
                  {payment.reconciliationCases.map((item) => (
                    <p key={item.caseId}>
                      {item.category} · {item.status}
                    </p>
                  ))}
                </section>
              ) : null}
              {payment.recentAudit.length ? (
                <section>
                  <h3 className="font-semibold text-[var(--fm-text)]">Audit</h3>
                  {payment.recentAudit.map((item) => (
                    <p key={item.auditEventId}>
                      {item.action} · {date(item.occurredAt)}
                    </p>
                  ))}
                </section>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}

function IssuePanel({
  item,
  locked,
  notice,
  onViewPayment,
  onClose,
  onRun,
}: {
  item: AdminPaymentAttentionItem;
  locked: boolean;
  notice: string | null;
  onViewPayment?: () => void;
  onClose: () => void;
  onRun: (url: string, body: string) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const action = selected === null ? null : item.actions[selected];
  function run() {
    if (!action || !reason.trim()) return;
    const common = { reason: reason.trim(), expectedVersion: action.expectedVersion };
    if (action.kind === "RETRY_PROVIDER_EVENT")
      onRun(
        "/api/admin/payments/event-retry",
        JSON.stringify({ ...common, caseId: action.caseId }),
      );
    else if (action.kind === "RETRY_PAYMENT_REACTION")
      onRun(
        "/api/admin/payments/reaction-retry",
        JSON.stringify({
          ...common,
          caseId: action.caseId,
          expectedPaymentVersion: action.expectedPaymentVersion,
        }),
      );
    else if (action.kind === "RECHECK_REFUND")
      onRun(
        "/api/admin/payments/refunds/recheck",
        JSON.stringify({ ...common, refundId: action.refundId }),
      );
    else
      onRun(
        "/api/admin/payments/recheck",
        JSON.stringify({
          ...common,
          paymentIntentId: item.paymentIntentId,
          expectedRecoveryVersion: action.expectedRecoveryVersion,
        }),
      );
  }
  return (
    <>
      <div className="flex items-start justify-between border-b p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Needs attention
          </p>
          <h2 id="payment-panel-title" className="mt-1 text-xl font-bold">
            {item.paymentIntentId ? "Payment issue" : "Unmatched payment"}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          aria-label="Close issue details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <p>{item.problem}</p>
        <p className="text-sm text-[var(--fm-text-muted)]">
          Opened {date(item.openedAt)}
          {item.state === "CHECKING_AUTOMATICALLY" ? " · Checking automatically" : ""}
        </p>
        {item.amountMinor !== null && item.currency ? (
          <p className="font-medium">{money(item.amountMinor, item.currency)}</p>
        ) : (
          <p className="text-sm">Amount unavailable</p>
        )}
        {onViewPayment ? (
          <Button variant="outline" disabled={locked} onClick={onViewPayment}>
            View payment details
          </Button>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        {item.actions.length === 0 ? (
          <p className="text-sm">
            No safe staff action is currently available. The retained verified evidence remains
            available in the payment history.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {item.actions.map((candidate, index) => (
                <Button
                  key={`${candidate.kind}:${candidate.caseId ?? candidate.refundId ?? index}`}
                  variant={selected === index ? "default" : "outline"}
                  disabled={locked}
                  onClick={() => setSelected(index)}
                >
                  {candidate.kind === "RECHECK_PAYMENT"
                    ? "Check payment status"
                    : candidate.kind === "RETRY_PROVIDER_EVENT"
                      ? "Retry provider event"
                      : candidate.kind === "RETRY_PAYMENT_REACTION"
                        ? "Retry Order confirmation"
                        : "Check refund status"}
                </Button>
              ))}
            </div>
            {action ? (
              <div className="flex gap-2">
                <Input
                  aria-label="Recovery reason"
                  maxLength={500}
                  value={reason}
                  disabled={locked}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Reason for recovery"
                />
                <Button disabled={locked || !reason.trim()} onClick={run}>
                  Confirm
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
          <p className="mt-3 break-all text-xs text-[var(--fm-text-muted)]">
            Issue key: {item.groupKey}
            <br />
            Cases: {item.caseIds.join(", ")}
          </p>
        </details>
      </div>
    </>
  );
}
