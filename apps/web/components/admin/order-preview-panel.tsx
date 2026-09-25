"use client";

import type { AdminOrderDetail, AdminOrderSummary, RpcResult } from "@freshmarkets/contracts";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminCancellationResponse } from "../../lib/order-cancellation-response";
import { useAdminCommandIntent } from "./admin-command-state";
import { useAdminRouteGuard } from "./use-admin-route-guard";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { notifyCommandSuccess } from "./admin-feedback";
import { AdminConfirmationDialog } from "./admin-controls";
import { AdminPageState } from "./admin-page-state";
import { OrderStatusBadge } from "./order-status-badge";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function orderLabel(order: AdminOrderSummary): string {
  return order.orderNumber ?? order.orderId;
}

export function OrderPreviewPanel({
  order,
  onClose,
  onUpdated,
}: {
  order: AdminOrderSummary;
  onClose(): void;
  onUpdated(order: AdminOrderDetail): void;
}) {
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [savedCancellation, setSavedCancellation] = useState<string | null>(null);
  const cancelIntent = useAdminCommandIntent();
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;
  const commandLocked =
    cancelIntent.pending || cancelIntent.uncertain || savedCancellation !== null || confirming;
  useAdminRouteGuard(false, commandLocked);
  useAdminScopeGuard(false, commandLocked);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      setRequestId(undefined);
      try {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(order.orderId)}`, {
          signal,
        });
        const payload = (await response.json()) as RpcResult<AdminOrderDetail>;
        if (!payload.ok) {
          setMessage(payload.error.message);
          setRequestId(payload.error.requestId);
          setState("error");
          return;
        }
        setDetail(payload.value);
        setState("ready");
        onUpdatedRef.current(payload.value);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("Network error loading the order preview.");
        setState("error");
      }
    },
    [order.orderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setMessage(null);
    setConfirming(false);
    setSavedCancellation(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function submitCancellation(body: string) {
    setSavedCancellation(body);
    setConfirming(false);
    try {
      const payload = await cancelIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/orders/${encodeURIComponent(order.orderId)}/cancel`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body,
          },
        );
        return adminCancellationResponse.parse(await response.json());
      });
      setSavedCancellation(null);
      if (!payload.ok) {
        setMessage(payload.error.message);
        return;
      }
      setMessage(
        payload.value.state === "CANCELED"
          ? "Order canceled."
          : "Cancellation accepted. Refund confirmation is still in progress.",
      );
      notifyCommandSuccess(
        payload.value.state === "CANCELED" ? "Order canceled" : "Cancellation accepted",
      );
      await load();
    } catch {
      setMessage("The status change could not be confirmed. Retry the saved cancellation.");
    }
  }

  function cancel(reason: string) {
    if (!detail || cancelIntent.pending || savedCancellation) return;
    void submitCancellation(
      JSON.stringify({ reasonCode: reason, expectedVersion: detail.version }),
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Order Preview
          </p>
          <h2 id="order-panel-title" className="mt-1 truncate text-xl font-bold tracking-[-0.03em]">
            {orderLabel(order)}
          </h2>
          <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
            {order.customerName ?? "Customer"} · {order.customerEmail}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close order preview"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {state === "loading" ? (
          <AdminPageState state="loading" title="Loading order preview" />
        ) : null}
        {state === "error" ? (
          <AdminPageState
            state="error"
            title="Order preview could not be loaded"
            message={message ?? undefined}
            requestId={requestId}
            onRetry={() => void load()}
          />
        ) : null}
        {state === "ready" && detail ? (
          <div className="space-y-5">
            {message ? (
              <div
                role="status"
                className="rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm"
              >
                <p>{message}</p>
                {savedCancellation ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={cancelIntent.pending}
                    onClick={() => void submitCancellation(savedCancellation)}
                  >
                    Retry saved cancellation
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid gap-1 text-sm font-medium">
                Status
                <Select
                  value={detail.status}
                  disabled={cancelIntent.pending || savedCancellation !== null}
                  onValueChange={(value) => {
                    if (value === "CANCELED" && detail.allowedActions.includes("CANCEL")) {
                      setConfirming(true);
                    }
                  }}
                >
                  <SelectTrigger className="min-w-48" indicator="up-down" aria-label="Order status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value={detail.status}>{humanize(detail.status)}</SelectItem>
                    {detail.allowedActions.includes("CANCEL") && detail.status !== "CANCELED" ? (
                      <SelectItem value="CANCELED">Canceled</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </label>
              <OrderStatusBadge status={detail.status} />
            </div>
            <p className="text-xs text-[var(--fm-text-muted)]">
              Available changes follow the order’s current lifecycle and your permissions.
            </p>
            {detail.fulfillment?.locationId ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link
                    href={`/admin/fulfillment?orderId=${encodeURIComponent(detail.orderId)}`}
                    prefetch={false}
                  >
                    Update preparation
                  </Link>
                </Button>
                {detail.delivery ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      href={`/admin/delivery?orderId=${encodeURIComponent(detail.orderId)}`}
                      prefetch={false}
                    >
                      Manage delivery
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}

            <section aria-labelledby="order-preview-items">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 id="order-preview-items" className="font-semibold">
                  Ordered items
                </h3>
                <span className="text-xs text-[var(--fm-text-muted)]">
                  {detail.items.length} {detail.items.length === 1 ? "item" : "items"}
                </span>
              </div>
              {detail.items.length > 0 ? (
                <Table aria-label={`Ordered items for ${orderLabel(detail)}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item, index) => (
                      <TableRow key={`${item.productName}-${item.variantName}-${index}`}>
                        <TableCell>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            {item.variantName} · {money(item.unitPriceMinor, detail.currency)}
                          </p>
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell className="font-medium">
                          {money(item.lineTotalMinor, detail.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="rounded-lg border border-[var(--fm-border)] p-4 text-sm text-[var(--fm-text-muted)]">
                  No item snapshots are available for this order.
                </p>
              )}
            </section>

            <dl className="divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
              {[
                ["Total", money(detail.totalMinor, detail.currency)],
                ["Committed", dateTime(detail.committedAt)],
                ["Fulfillment", humanize(detail.fulfillmentMode)],
                ["Order ID", detail.orderId],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 px-3 py-3 text-sm"
                >
                  <dt className="text-[var(--fm-text-muted)]">{label}</dt>
                  <dd className="max-w-64 break-all text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button asChild>
          <Link href={`/admin/orders/${order.orderId}`} prefetch={false}>
            <ExternalLink aria-hidden="true" />
            Full order
          </Link>
        </Button>
      </div>

      {detail ? (
        <AdminConfirmationDialog
          open={confirming}
          title="Confirm order cancellation"
          resource={`Order ${orderLabel(detail)} · ${money(detail.totalMinor, detail.currency)}`}
          scope="FreshMarkets order"
          consequence="This cancels the whole order and requests refunds for its original payment and paid additions. Refunds remain pending until confirmed by the payment provider."
          pending={cancelIntent.pending}
          onCancel={() => setConfirming(false)}
          onConfirm={cancel}
        />
      ) : null}
    </>
  );
}
