"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminOrderDetail, RpcResult } from "@freshmarkets/contracts";
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
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";

export default function OrderDetailPage({ params }: { params: Promise<{ "order-id": string }> }) {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelIntent = useAdminCommandIntent();
  const load = useCallback(async (id: string) => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/orders/${encodeURIComponent(id)}`)
      ).json()) as RpcResult<AdminOrderDetail>;
      if (!payload.ok) {
        setMessage(payload.error.message);
        setState("error");
        return;
      }
      setOrder(payload.value);
      setState("ready");
    } catch {
      setMessage("Network error loading the order.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void params.then(({ "order-id": id }) => {
      setOrderId(id);
      void load(id);
    });
  }, [params, load]);
  async function cancel(reason: string) {
    if (!order) return;
    try {
      const payload = await cancelIntent.submit(async (idempotencyKey) => {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ reasonCode: reason, expectedVersion: order.version }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
      setMessage(payload.ok ? "Cancellation submitted." : payload.error.message);
      if (payload.ok) {
        setConfirming(false);
        await load(orderId);
      }
    } catch {
      setMessage("Connection lost. Retry confirmation to safely reuse the cancellation request.");
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Link href="/admin/orders" className="text-sm underline">
        ← Orders
      </Link>
      {state === "loading" ? (
        <div role="status">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Order could not be loaded</AlertTitle>
          <AlertDescription>
            {message}
            <br />
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load(orderId)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && order ? (
        <>
          <PageHeader
            title={`Order ${order.orderId}`}
            description={`${order.customerEmail} · ${order.currency} ${(order.totalMinor / 100).toFixed(2)}`}
            action={<StatusBadge>{order.status}</StatusBadge>}
          />
          {message ? (
            <p role="status" className="border p-3 text-sm">
              {message}
            </p>
          ) : null}
          <ListPageSection title="Items">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item, index) => (
                  <TableRow key={`${item.skuName}-${index}`}>
                    <TableCell>{item.skuName}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>
                      {order.currency} {(item.unitPriceMinor / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {order.currency} {(item.lineTotalMinor / 100).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPageSection>
          <ListPageSection
            title="Cancellation"
            description="Uses the canonical order cancellation command and refund seam."
          >
            <div className="p-4">
              <Button
                disabled={cancelIntent.pending || !order.allowedActions.includes("CANCEL")}
                variant="destructive"
                onClick={() => setConfirming(true)}
              >
                Cancel order
              </Button>
            </div>
          </ListPageSection>
          <AdminConfirmationDialog
            open={confirming}
            title="Confirm order cancellation"
            resource={`Order ${order.orderId} · ${order.currency} ${(order.totalMinor / 100).toFixed(2)}`}
            scope="Core-authorized order scope"
            consequence="Cancellation is a lifecycle transition and may initiate refund handling; it cannot be treated as an arbitrary edit."
            pending={cancelIntent.pending}
            onCancel={() => setConfirming(false)}
            onConfirm={(confirmedReason) => void cancel(confirmedReason)}
          />
          <ListPageSection title="Recent audit">
            <ul className="divide-y text-sm">
              {order.recentAudit.map((event) => (
                <li className="p-3" key={event.auditEventId}>
                  <span className="font-medium">{event.action}</span> ·{" "}
                  {event.occurredAt.slice(0, 19)}
                  {event.reason ? ` · ${event.reason}` : ""}
                </li>
              ))}
            </ul>
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
