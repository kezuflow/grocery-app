"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminOrderPage, RpcResult } from "@freshmarkets/contracts";
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

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

export default function OrdersPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [page, setPage] = useState<AdminOrderPage | null>(null);
  const [status, setStatus] = useState("");
  const load = useCallback(
    async (nextStatus = status) => {
      setState({ phase: "loading" });
      try {
        const query = new URLSearchParams({ limit: "50" });
        if (nextStatus) query.set("status", nextStatus);
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
    },
    [status],
  );
  useEffect(() => {
    void load("");
  }, [load]);
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
      {state.phase === "loading" ? (
        <div role="status" aria-label="Loading orders">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Orders could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.phase === "ready" ? (
        <ListPageSection title="Order queue">
          <form
            className="flex gap-2 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void load(status);
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
                  void load("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
          {!page || page.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
              No orders match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fulfillment</TableHead>
                  <TableHead>Committed</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((order) => (
                  <TableRow key={order.orderId}>
                    <TableCell>{order.customerEmail}</TableCell>
                    <TableCell>
                      <StatusBadge>{order.status}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      {order.currency} {(order.totalMinor / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>{order.paymentStatus ?? "—"}</TableCell>
                    <TableCell>{order.fulfillmentStatus ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {order.committedAt ? order.committedAt.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        className="text-xs font-medium underline"
                        href={`/admin/orders/${order.orderId}`}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ListPageSection>
      ) : null}
    </div>
  );
}
