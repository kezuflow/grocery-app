"use client";

import type { AdminOrderPage, AdminOrderSummary, RpcResult } from "@freshmarkets/contracts";
import { Clipboard, EllipsisVertical, Eye, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { OrderStatusBadge } from "../../../components/admin/order-status-badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

const orderViews = [
  { label: "All", status: "" },
  { label: "Committed", status: "COMMITTED" },
  { label: "Pending", status: "FULFILLMENT_PENDING" },
  { label: "Out for delivery", status: "OUT_FOR_DELIVERY" },
  { label: "Delivered", status: "DELIVERED" },
  { label: "Canceled", status: "CANCELED" },
] as const;

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function orderLabel(order: AdminOrderSummary): string {
  return order.orderNumber ?? order.orderId;
}

export default function OrdersPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [page, setPage] = useState<AdminOrderPage | null>(null);
  const [status, setStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const pagination = useAdminPagination(status);

  const load = useCallback(async (nextStatus: string, cursor: string | null) => {
    setState({ phase: "loading" });
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextStatus) query.set("status", nextStatus);
      if (cursor) query.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/orders?${query}`)
      ).json()) as RpcResult<AdminOrderPage>;
      if (!payload.ok) {
        setState({
          phase: "error",
          message: payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage(payload.value);
      setSelectedIds(new Set());
      setState({ phase: "ready" });
    } catch {
      setState({ phase: "error", message: "Network error loading orders." });
    }
  }, []);

  useEffect(() => {
    void load(status, pagination.cursor);
  }, [status, load, pagination.cursor]);

  const visibleOrders = page?.items ?? [];
  const allSelected = visibleOrders.length > 0 && selectedIds.size === visibleOrders.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function selectOrder(orderId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  async function copyOrderId(order: AdminOrderSummary) {
    const value = order.orderNumber ?? order.orderId;
    await navigator.clipboard.writeText(value);
    setCopiedId(order.orderId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === order.orderId ? null : current));
    }, 2_000);
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader title="Orders" />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Order list</h2>
        <div
          className="flex min-h-14 items-end gap-1 overflow-x-auto border-b border-[var(--fm-border)] px-3 pt-2"
          aria-label="Order status views"
        >
          {orderViews.map((view) => (
            <button
              type="button"
              key={view.label}
              aria-pressed={status === view.status}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                status === view.status
                  ? "border-[var(--fm-text)] text-[var(--fm-text)]"
                  : "border-transparent text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
              }`}
              onClick={() => {
                setStatus(view.status);
                pagination.reset();
              }}
            >
              {view.label}
            </button>
          ))}
        </div>

        {selectedIds.size > 0 ? (
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-2.5">
            <p className="text-sm font-medium" role="status" aria-live="polite">
              {selectedIds.size} selected
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds(new Set())}
            >
              <X aria-hidden="true" />
              Clear selection
            </Button>
          </div>
        ) : null}

        {copiedId ? (
          <p className="sr-only" role="status">
            Order ID copied.
          </p>
        ) : null}
        {state.phase === "loading" ? (
          <div className="p-4">
            <AdminPageState state="loading" title="Loading orders" />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="p-4">
            <AdminPageState
              state="error"
              title="Orders could not be loaded"
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load(status, pagination.cursor)}
            />
          </div>
        ) : null}
        {state.phase === "ready" && visibleOrders.length === 0 ? (
          <div className="p-4">
            <AdminPageState
              state={status ? "filtered-empty" : "empty"}
              message="No orders are visible in this view."
            />
          </div>
        ) : null}
        {state.phase === "ready" && visibleOrders.length > 0 ? (
          <Table aria-label="Order list">
            <TableHeader>
              <TableRow>
                <TableHead className="w-11">
                  <Checkbox
                    aria-label="Select all orders on this page"
                    checked={someSelected ? "indeterminate" : allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedIds(
                        checked === true
                          ? new Set(visibleOrders.map((order) => order.orderId))
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleOrders.map((order) => (
                <TableRow
                  key={order.orderId}
                  data-state={selectedIds.has(order.orderId) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select order ${orderLabel(order)}`}
                      checked={selectedIds.has(order.orderId)}
                      onCheckedChange={(checked) => selectOrder(order.orderId, checked === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/admin/orders/${order.orderId}`}
                      prefetch={false}
                    >
                      {orderLabel(order)}
                    </Link>
                    {order.orderNumber ? (
                      <p className="mt-0.5 max-w-40 truncate font-mono text-[11px] text-[var(--fm-text-muted)]">
                        {order.orderId}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{order.customerName ?? "Customer"}</p>
                    <p className="text-xs text-[var(--fm-text-muted)]">{order.customerEmail}</p>
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {order.fulfillmentMode.toLowerCase()}
                  </TableCell>
                  <TableCell className="font-medium">
                    {money(order.totalMinor, order.currency)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-[var(--fm-text-muted)]">
                    {date(order.committedAt)}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open actions for order ${orderLabel(order)}`}
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/orders/${order.orderId}`} prefetch={false}>
                            <Eye aria-hidden="true" />
                            View details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void copyOrderId(order)}>
                          <Clipboard aria-hidden="true" />
                          {copiedId === order.orderId ? "Copied" : "Copy order ID"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {state.phase === "ready" ? (
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page?.nextCursor ?? null}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        ) : null}
      </section>
    </div>
  );
}
