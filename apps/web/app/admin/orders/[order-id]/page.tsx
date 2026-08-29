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

function money(amountMinor: number | null, currency: string): string {
  return amountMinor === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

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
          {order.exceptions.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Operational attention required</AlertTitle>
              <AlertDescription>
                {order.exceptions.length} open or historical exception
                {order.exceptions.length === 1 ? "" : "s"} are attached to this order.
              </AlertDescription>
            </Alert>
          ) : null}
          <ListPageSection
            title="Financial snapshot"
            description={
              order.financial.source === "CHECKOUT_QUOTE"
                ? "Immutable values captured at checkout."
                : "Only the committed order total is available for this historical order."
            }
          >
            <dl className="grid gap-4 p-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[var(--fm-text-muted)]">Subtotal</dt>
                <dd className="font-semibold">
                  {money(order.financial.subtotalMinor, order.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Discount</dt>
                <dd className="font-semibold">
                  {money(order.financial.discountMinor, order.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Delivery</dt>
                <dd className="font-semibold">
                  {money(order.financial.deliveryFeeMinor, order.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Total</dt>
                <dd className="font-semibold">
                  {money(order.financial.totalMinor, order.currency)}
                </dd>
              </div>
            </dl>
          </ListPageSection>
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
                  <TableRow key={`${item.productName}-${item.variantName}-${index}`}>
                    <TableCell>
                      <span className="font-medium">{item.productName}</span>
                      <br />
                      <span className="text-xs text-[var(--fm-text-muted)]">
                        {item.variantName} · {item.baseQuantity} {item.unit.toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{money(item.unitPriceMinor, order.currency)}</TableCell>
                    <TableCell>{money(item.lineTotalMinor, order.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPageSection>
          <ListPageSection title="Payments">
            {order.payments.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">
                No payment intent is linked to this order.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {order.payments.map((payment) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                    key={payment.paymentIntentId}
                  >
                    <div>
                      <Link
                        className="font-medium underline"
                        href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                      >
                        {payment.purpose}
                      </Link>
                      <p className="text-xs text-[var(--fm-text-muted)]">
                        {payment.paymentIntentId}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge>{payment.status}</StatusBadge>
                      <p>
                        {money(payment.amountMinor, payment.currency)} · refunded{" "}
                        {money(payment.refundedMinor, payment.currency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
          <ListPageSection
            title="Amendments"
            description="Post-payment additions retain independent item, price, and payment history."
          >
            {order.amendments.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No amendments.</p>
            ) : (
              <div className="divide-y">
                {order.amendments.map((amendment) => (
                  <article className="space-y-2 p-4 text-sm" key={amendment.amendmentId}>
                    <div className="flex justify-between">
                      <span className="font-medium">{amendment.amendmentId}</span>
                      <StatusBadge>{amendment.status}</StatusBadge>
                    </div>
                    <p>
                      {money(amendment.totalMinor, amendment.currency)} · {amendment.lines.length}{" "}
                      line{amendment.lines.length === 1 ? "" : "s"}
                    </p>
                    {amendment.paymentIntentId ? (
                      <Link
                        className="underline"
                        href={`/admin/payments/transactions/${amendment.paymentIntentId}`}
                      >
                        Open amendment payment
                      </Link>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </ListPageSection>
          <div className="grid gap-6 lg:grid-cols-2">
            <ListPageSection title="Fulfillment">
              {order.fulfillment ? (
                <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Mode</dt>
                    <dd>{order.fulfillment.fulfillmentMode}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Status</dt>
                    <dd>{order.fulfillment.status ?? "Not started"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Location</dt>
                    <dd>{order.fulfillment.locationId}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Promise</dt>
                    <dd>{order.fulfillment.promisedAt ?? order.fulfillment.deliveryDate ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="p-4 text-sm text-[var(--fm-text-muted)]">No fulfillment snapshot.</p>
              )}
            </ListPageSection>
            <ListPageSection title="Delivery">
              {order.delivery ? (
                <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Status</dt>
                    <dd>
                      <StatusBadge>{order.delivery.status}</StatusBadge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Rider</dt>
                    <dd>{order.delivery.riderUserId ?? "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Version</dt>
                    <dd>{order.delivery.version}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--fm-text-muted)]">Delivered</dt>
                    <dd>{order.delivery.deliveredAt ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="p-4 text-sm text-[var(--fm-text-muted)]">No delivery job.</p>
              )}
            </ListPageSection>
          </div>
          <ListPageSection title="Exceptions">
            {order.exceptions.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No exceptions.</p>
            ) : (
              <ul className="divide-y text-sm">
                {order.exceptions.map((exception) => (
                  <li className="p-4" key={exception.exceptionId}>
                    <div className="flex justify-between">
                      <strong>{exception.kind}</strong>
                      <StatusBadge>{exception.status}</StatusBadge>
                    </div>
                    <p className="text-[var(--fm-text-muted)]">
                      {exception.source}
                      {exception.details ? ` · ${exception.details}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
          <ListPageSection title="Timeline">
            {order.timeline.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No lifecycle events.</p>
            ) : (
              <ol className="divide-y text-sm">
                {order.timeline.map((entry) => (
                  <li className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr_auto]" key={entry.eventId}>
                    <time className="text-xs text-[var(--fm-text-muted)]">
                      {entry.occurredAt.slice(0, 19)}
                    </time>
                    <span>{entry.label}</span>
                    {entry.status ? <StatusBadge>{entry.status}</StatusBadge> : null}
                  </li>
                ))}
              </ol>
            )}
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
