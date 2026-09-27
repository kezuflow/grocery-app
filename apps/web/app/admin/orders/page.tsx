"use client";

import type {
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clipboard,
  Clock3,
  EllipsisVertical,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminUrlPagination } from "../../../components/admin/admin-controls";
import { useAdminContext } from "../admin-context-provider";
import { AdminMasterDetailWorkspace } from "../../../components/admin/admin-master-detail-workspace";
import { orderProgressFacts } from "../../../components/admin/order-progress-status";
import { OrderPreviewPanel } from "../../../components/admin/order-preview-panel";
import { tryChangeAdminWorkspace } from "../../../components/admin/use-admin-route-guard";
import { Alert, AlertDescription, AlertTitle } from "../../../components/admin/shadcn/alert";
import { Badge } from "../../../components/admin/shadcn/badge";
import { Button } from "../../../components/admin/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/admin/shadcn/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/admin/shadcn/dropdown-menu";
import { Skeleton } from "../../../components/admin/shadcn/skeleton";
import { Input } from "../../../components/admin/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../../components/admin/shadcn/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/admin/shadcn/table";

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

function OrdersProgressStatus({ order }: { order: AdminOrderSummary }) {
  const facts = orderProgressFacts(order);
  return (
    <div
      className="flex max-w-52 flex-wrap gap-x-3 gap-y-1"
      aria-label={`Order progress: ${facts.map((fact) => fact.label).join("; ")}`}
    >
      {facts.map((fact) => {
        const Icon =
          fact.tone === "success"
            ? CircleCheck
            : fact.tone === "danger"
              ? CircleX
              : fact.tone === "warning"
                ? CircleHelp
                : fact.tone === "neutral"
                  ? Circle
                  : Clock3;
        return (
          <span
            key={fact.code}
            className="inline-flex items-center gap-2 text-sm whitespace-nowrap"
          >
            <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            {fact.label}
          </span>
        );
      })}
    </div>
  );
}

function OrdersPagination({
  pageNumber,
  nextCursor,
  onPrevious,
  onNext,
}: {
  pageNumber: number;
  nextCursor: string | null;
  onPrevious(): void;
  onNext(cursor: string): void;
}) {
  return (
    <nav aria-label="Results pagination" className="flex items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Previous"
        disabled={pageNumber <= 1}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span className="min-w-14 text-center text-sm text-muted-foreground">Page {pageNumber}</span>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Next"
        disabled={nextCursor === null}
        onClick={() => nextCursor && onNext(nextCursor)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
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
  const [pageFilter, setPageFilter] = useState("");
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

  const pageOrders = page?.items ?? [];
  const normalizedFilter = pageFilter.trim().toLocaleLowerCase();
  const visibleOrders = normalizedFilter
    ? pageOrders.filter((order) =>
        [
          order.orderNumber,
          order.orderId,
          order.customerName,
          order.customerEmail,
          order.fulfillmentMode,
          ...orderProgressFacts(order).map((fact) => fact.label),
        ]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedFilter)),
      )
    : pageOrders;
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
    <section
      className="fm-admin-orders min-h-[calc(100svh-3.5rem)] p-4 sm:p-6"
      aria-labelledby="admin-page-title"
    >
      <Card className="gap-0 overflow-hidden border-border py-0 shadow-none">
        <CardHeader className="gap-1 px-4 pt-6 pb-5 sm:px-6 sm:pt-8 sm:pb-7">
          <CardTitle>
            <h1 id="admin-page-title" className="text-2xl font-semibold tracking-tight">
              Orders
            </h1>
          </CardTitle>
          <CardDescription>Review and manage your orders.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 pb-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Filter orders on this page"
              placeholder="Filter orders on this page..."
              value={pageFilter}
              onChange={(event) => setPageFilter(event.target.value)}
              className="w-full sm:w-64"
            />
            <Select
              value={status || "ALL"}
              onValueChange={(nextStatus) => selectView(nextStatus === "ALL" ? "" : nextStatus)}
            >
              <SelectTrigger aria-label="Order status view" className="w-auto min-w-28">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Status</SelectLabel>
                  {orderViews.map((view) => (
                    <SelectItem key={view.status} value={view.status || "ALL"}>
                      {view.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {copiedId ? (
            <p className="sr-only" role="status">
              Order ID copied.
            </p>
          ) : null}
          {state.phase === "loading" ? (
            <div
              className="flex flex-col gap-3 rounded-md border border-border p-4"
              role="status"
              aria-label="Loading orders"
            >
              <span className="sr-only">Loading orders</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
          {state.phase === "error" ? (
            <div>
              <Alert variant="destructive">
                <AlertTitle>Orders could not be loaded</AlertTitle>
                <AlertDescription>
                  {state.message}
                  {state.requestId ? (
                    <span className="block font-mono text-xs">
                      Request reference: {state.requestId}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void load(status, pagination.cursor)}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          {state.phase === "ready" && visibleOrders.length === 0 ? (
            <div>
              <Alert role="status">
                <AlertTitle>
                  {pageFilter || status ? "No matching results" : "Nothing to show"}
                </AlertTitle>
                <AlertDescription>
                  {pageFilter
                    ? "No orders on this page match the filter."
                    : "No orders are visible in this view."}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          {state.phase === "ready" && visibleOrders.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border">
              <ul aria-label="Order list" className="divide-y divide-border lg:hidden">
                {visibleOrders.map((order) => (
                  <li key={order.orderId} className="flex flex-col gap-3 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={recordHref(order)}
                          onClick={rememberReturn}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {orderLabel(order)}
                        </Link>
                        <p className="truncate text-sm text-muted-foreground">
                          {order.customerName ?? "Customer"}
                        </p>
                      </div>
                      <OrdersProgressStatus order={order} />
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {date(order.committedAt)} · {order.fulfillmentMode.toLowerCase()}
                      </span>
                      <span className="font-medium">{money(order.totalMinor, order.currency)}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => openOrderPreview(order)}
                    >
                      Preview order
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="hidden lg:block">
                <Table aria-label="Order list">
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="pl-4 xl:pl-6">Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-center">Mode</TableHead>
                      <TableHead className="text-center xl:w-32">Amount</TableHead>
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
                        className="h-12 cursor-pointer border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                        <TableCell className="pl-4 font-medium xl:pl-6">
                          <Link
                            href={recordHref(order)}
                            className="whitespace-nowrap hover:underline"
                            onClick={rememberReturn}
                          >
                            {orderLabel(order)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{order.customerName ?? "Customer"}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="capitalize">
                            {order.fulfillmentMode.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center font-medium tabular-nums">
                          {money(order.totalMinor, order.currency)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {date(order.committedAt)}
                        </TableCell>
                        <TableCell>
                          <OrdersProgressStatus order={order} />
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
                            <DropdownMenuContent align="end" className="fm-admin-orders">
                              <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={() => openOrderPreview(order)}>
                                  <Eye aria-hidden="true" />
                                  View details
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void copyOrderId(order)}>
                                  <Clipboard aria-hidden="true" />
                                  {copiedId === order.orderId ? "Copied" : "Copy order ID"}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
        {state.phase === "ready" ? (
          <CardFooter className="flex-col items-start gap-3 px-4 pt-2 pb-5 sm:flex-row sm:justify-between sm:px-6">
            <span className="text-sm text-muted-foreground">
              Showing {visibleOrders.length} of {pageOrders.length}{" "}
              {pageOrders.length === 1 ? "order" : "orders"} on this page
            </span>
            <OrdersPagination
              pageNumber={pagination.pageNumber}
              nextCursor={page?.nextCursor ?? null}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </CardFooter>
        ) : null}
      </Card>
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
