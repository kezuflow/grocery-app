"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminOrderPage, AdminOrderSummary, RpcResult } from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import {
  AdminCursorPagination,
  useAdminPagination,
  FilterBar,
} from "../../../components/admin/admin-controls";
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from "../../../components/admin/admin-data-table";
import { AdminPageState } from "../../../components/admin/admin-page-state";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

export default function OrdersPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [page, setPage] = useState<AdminOrderPage | null>(null);
  const [status, setStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const pagination = useAdminPagination();
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
      setState({ phase: "ready" });
    } catch {
      setState({ phase: "error", message: "Network error loading orders." });
    }
  }, []);
  useEffect(() => {
    void load(appliedStatus, pagination.cursor);
  }, [appliedStatus, load, pagination.cursor]);
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Orders"
        description="Committed orders with payment, fulfillment, and delivery status."
      />
      <nav aria-label="Order administration" className="flex gap-3 text-sm">
        <Link className="font-semibold underline" href="/admin/orders">
          Orders
        </Link>
        <Link className="underline" href="/admin/issues">
          Customer issues
        </Link>
      </nav>
      {state.phase === "loading" ? <AdminPageState state="loading" title="Loading orders" /> : null}
      {state.phase === "error" ? (
        <AdminPageState
          state="error"
          title="Orders could not be loaded"
          message={state.message}
          requestId={state.requestId}
          onRetry={() => void load(appliedStatus, pagination.cursor)}
        />
      ) : null}
      {state.phase === "ready" ? (
        <ListPageSection title="Order queue">
          <FilterBar
            label="Order filters"
            onSubmit={() => {
              setAppliedStatus(status.trim());
              pagination.reset();
            }}
          >
            <Input
              aria-label="Order status"
              placeholder="status (optional)"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="sm:w-56"
            />
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
            {status ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setStatus("");
                  setAppliedStatus("");
                  pagination.reset();
                }}
              >
                Clear
              </Button>
            ) : null}
          </FilterBar>
          {!page || page.items.length === 0 ? (
            <div className="p-4">
              <AdminPageState
                state={appliedStatus ? "filtered-empty" : "empty"}
                message="No orders are visible in this queue."
              />
            </div>
          ) : (
            <AdminDataTable<AdminOrderSummary>
              ariaLabel="Order queue"
              rows={page.items}
              rowKey={(order) => order.orderId}
              columns={
                [
                  { key: "customer", header: "Customer", render: (order) => order.customerEmail },
                  {
                    key: "status",
                    header: "Status",
                    render: (order) => <StatusBadge>{order.status}</StatusBadge>,
                  },
                  {
                    key: "total",
                    header: "Total",
                    render: (order) => `${order.currency} ${(order.totalMinor / 100).toFixed(2)}`,
                  },
                  {
                    key: "payment",
                    header: "Payment",
                    render: (order) => order.paymentStatus ?? "—",
                  },
                  {
                    key: "fulfillment",
                    header: "Fulfillment",
                    render: (order) => order.fulfillmentStatus ?? "—",
                  },
                  {
                    key: "committed",
                    header: "Committed",
                    className: "text-xs",
                    render: (order) => (order.committedAt ? order.committedAt.slice(0, 10) : "—"),
                  },
                  {
                    key: "open",
                    header: "Actions",
                    render: (order) => (
                      <Link
                        className="text-xs font-medium underline"
                        href={`/admin/orders/${order.orderId}`}
                      >
                        Open
                      </Link>
                    ),
                  },
                ] satisfies ReadonlyArray<AdminDataTableColumn<AdminOrderSummary>>
              }
            />
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page?.nextCursor ?? null}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </ListPageSection>
      ) : null}
    </div>
  );
}
