"use client";

import type {
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { Clipboard, EllipsisVertical, Eye } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminCursorPagination,
  AdminIndexViews,
  useAdminUrlPagination,
} from "../../../components/admin/admin-controls";
import { useAdminContext } from "../admin-context-provider";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { AdminMasterDetailWorkspace } from "../../../components/admin/admin-master-detail-workspace";
import { PageHeader } from "../../../components/admin/admin-shell";
import { OrderProgressStatus } from "../../../components/admin/order-progress-status";
import { OrderPreviewPanel } from "../../../components/admin/order-preview-panel";
import { tryChangeAdminWorkspace } from "../../../components/admin/use-admin-route-guard";
import { Button } from "../../../components/ui/button";
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
  const { state } = useAdminContext();
  const scopeKey = state.phase === "ready" ? JSON.stringify(state.selectedScope) : "loading";
  return <OrdersWorkspace key={scopeKey} scopeKey={scopeKey} />;
}

function OrdersWorkspace({ scopeKey }: { scopeKey: string }) {
  const requestVersion = useRef(0);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [page, setPage] = useState<AdminOrderPage | null>(null);
  const searchParams = useSearchParams();
  const requestedStatus = searchParams.get("status") ?? "";
  const status = orderViews.some((view) => view.status === requestedStatus) ? requestedStatus : "";
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderSummary | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const pagination = useAdminUrlPagination("/admin/orders");
  const listUrl = `/admin/orders${searchParams.size ? `?${searchParams}` : ""}`;
  function recordHref(order: AdminOrderSummary) {
    return `/admin/orders/${encodeURIComponent(order.orderId)}?returnTo=${encodeURIComponent(listUrl)}&returnScope=${encodeURIComponent(scopeKey)}`;
  }
  function rememberReturn() {
    sessionStorage.setItem(
      `freshmarkets.admin.orders.return:${scopeKey}`,
      JSON.stringify({ url: listUrl, y: window.scrollY }),
    );
  }
  useEffect(() => {
    if (state.phase !== "ready") return;
    const key = `freshmarkets.admin.orders.return:${scopeKey}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return;
    sessionStorage.removeItem(key);
    try {
      const target = JSON.parse(stored) as { url: string; y: number };
      if (target.url === `${window.location.pathname}${window.location.search}` && target.y >= 0) {
        window.requestAnimationFrame(() => window.scrollTo(0, target.y));
      }
    } catch {
      // An invalid return position cannot change the order list.
    }
  }, [scopeKey, state.phase]);

  function selectView(nextStatus: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (nextStatus) next.set("status", nextStatus);
    else next.delete("status");
    pagination.reset(next);
    window.history.pushState(null, "", `/admin/orders${next.size ? `?${next}` : ""}`);
  }

  const load = useCallback(async (nextStatus: string, cursor: string | null) => {
    const version = ++requestVersion.current;
    setState({ phase: "loading" });
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextStatus) query.set("status", nextStatus);
      if (cursor) query.set("cursor", cursor);
      const payload = (await (
        await fetch(`/api/admin/orders?${query}`)
      ).json()) as RpcResult<AdminOrderPage>;
      if (version !== requestVersion.current) return;
      if (!payload.ok) {
        setState({
          phase: "error",
          message: payload.error.message,
          requestId: payload.error.requestId,
        });
        return;
      }
      setPage(payload.value);
      setState({ phase: "ready" });
    } catch {
      if (version !== requestVersion.current) return;
      setState({ phase: "error", message: "Network error loading orders." });
    }
  }, []);

  useEffect(() => {
    void load(status, pagination.cursor);
    return () => {
      requestVersion.current += 1;
    };
  }, [status, load, pagination.cursor]);

  const visibleOrders = page?.items ?? [];
  async function copyOrderId(order: AdminOrderSummary) {
    const value = order.orderNumber ?? order.orderId;
    await navigator.clipboard.writeText(value);
    setCopiedId(order.orderId);
    window.setTimeout(() => {
      setCopiedId((current) => (current === order.orderId ? null : current));
    }, 2_000);
  }

  function openOrderPreview(order: AdminOrderSummary) {
    tryChangeAdminWorkspace(() => {
      setSelectedOrder(order);
      setPanelOpen(true);
    });
  }

  const updateSelectedOrder = useCallback(
    (order: AdminOrderDetail) => {
      setSelectedOrder((current) => (current?.orderId === order.orderId ? order : current));
      setPage((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.orderId === order.orderId ? order : item)),
            }
          : current,
      );
      if (status && status !== order.status) void load(status, pagination.cursor);
    },
    [load, pagination.cursor, status],
  );

  const master = (
    <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader title="Orders" />

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Order list</h2>
        <AdminIndexViews
          label="Order status views"
          views={orderViews}
          value={status}
          onChange={selectView}
        />

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
          <>
            <ul aria-label="Order list" className="divide-y divide-[var(--fm-border)] sm:hidden">
              {visibleOrders.map((order) => (
                <li key={order.orderId} className="space-y-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={recordHref(order)}
                        onClick={rememberReturn}
                        className="font-semibold text-[var(--fm-text)] hover:underline"
                      >
                        {orderLabel(order)}
                      </Link>
                      <p className="truncate text-sm text-[var(--fm-text-muted)]">
                        {order.customerName ?? "Customer"}
                      </p>
                    </div>
                    <OrderProgressStatus order={order} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--fm-text-muted)]">
                      {date(order.committedAt)} · {order.fulfillmentMode.toLowerCase()}
                    </span>
                    <span className="font-medium">{money(order.totalMinor, order.currency)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openOrderPreview(order)}
                  >
                    Preview order
                  </Button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table aria-label="Order list">
                <TableHeader>
                  <TableRow>
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
                      tabIndex={0}
                      aria-label={`Preview order ${orderLabel(order)}`}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fm-focus)]"
                      onClick={(event) => {
                        if (
                          (event.target as Element).closest("button, a, input, [role='menuitem']")
                        )
                          return;
                        openOrderPreview(order);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openOrderPreview(order);
                        }
                      }}
                    >
                      <TableCell>
                        <Link
                          href={recordHref(order)}
                          className="font-medium hover:underline"
                          onClick={rememberReturn}
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
                        <OrderProgressStatus order={order} />
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
                            <DropdownMenuItem onSelect={() => openOrderPreview(order)}>
                              <Eye aria-hidden="true" />
                              View details
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
            </div>
          </>
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
    </section>
  );

  const detail = selectedOrder ? (
    <OrderPreviewPanel
      order={selectedOrder}
      onClose={() => tryChangeAdminWorkspace(() => setPanelOpen(false))}
      onUpdated={updateSelectedOrder}
    />
  ) : null;

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen && selectedOrder !== null}
      master={master}
      detail={detail}
      detailKey={selectedOrder?.orderId}
      panelId="order-detail-panel"
      labelledBy="order-panel-title"
      resizeLabel="Resize order preview"
    />
  );
}
