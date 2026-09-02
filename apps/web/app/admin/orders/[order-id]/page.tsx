"use client";

import type { AdminOrderDetail, RpcResult } from "@freshmarkets/contracts";
import { ArrowLeft, Clipboard, MapPin, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { AdminLiveRegion, AdminTimeline } from "../../../../components/admin/admin-page-state";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { OrderStatusBadge } from "../../../../components/admin/order-status-badge";
import { OrderIssueStatusBadge } from "../../../../components/admin/order-issue-status-badge";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Separator } from "../../../../components/ui/separator";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";

function money(amountMinor: number | null, currency: string): string {
  return amountMinor === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
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

const deliveryStages = ["Processing", "Ready", "Out for delivery", "Delivered"] as const;

function deliveryStage(order: AdminOrderDetail): number {
  if (order.status === "DELIVERED") return 3;
  if (order.status === "OUT_FOR_DELIVERY") return 2;
  if (order.status === "FULFILLMENT_READY") return 1;
  return 0;
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-[var(--fm-text-muted)]">{label}</dt>
      <dd className={muted ? "text-[var(--fm-text-muted)]" : "font-medium"}>{value}</dd>
    </div>
  );
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

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  }

  const customerIssues = order?.exceptions.filter((item) => item.source === "ORDER_ISSUE") ?? [];
  const financeExceptions = order?.exceptions.filter((item) => item.source === "FINANCE") ?? [];
  const openFinanceExceptions = financeExceptions.filter((item) => item.status !== "RESOLVED");

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Orders
      </Link>

      {state === "loading" ? (
        <div role="status" className="space-y-4">
          <Skeleton className="h-12 w-80" />
          <Skeleton className="h-64 w-full" />
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
            title={`Order ${order.orderNumber ?? order.orderId}`}
            description={`Placed ${dateTime(order.committedAt)} · ${order.fulfillmentMode === "INSTANT" ? "Instant" : "Scheduled"}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} />
                {order.allowedActions.includes("CANCEL") ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={cancelIntent.pending}
                    onClick={() => setConfirming(true)}
                  >
                    Cancel order
                  </Button>
                ) : null}
              </div>
            }
          />
          <AdminLiveRegion message={message} />

          {openFinanceExceptions.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Payment attention required</AlertTitle>
              <AlertDescription>
                {openFinanceExceptions.length} unresolved payment exception
                {openFinanceExceptions.length === 1 ? "" : "s"} attached to this order.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]">
            <div className="space-y-6">
              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Customer information</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-5 px-5 sm:grid-cols-2">
                  <div className="flex gap-3">
                    <UserRound
                      className="mt-0.5 size-5 text-[var(--fm-text-muted)]"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{order.customer.name ?? "Customer"}</p>
                      <a
                        className="break-all text-[var(--fm-text-muted)] hover:underline"
                        href={`mailto:${order.customer.email}`}
                      >
                        {order.customer.email}
                      </a>
                      {order.customer.phone ? (
                        <a
                          className="mt-1 block text-[var(--fm-text-muted)] hover:underline"
                          href={`tel:${order.customer.phone}`}
                        >
                          {order.customer.phone}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <MapPin
                      className="mt-0.5 size-5 text-[var(--fm-text-muted)]"
                      aria-hidden="true"
                    />
                    <div className="text-sm">
                      <p className="font-medium">Delivery address</p>
                      <p className="mt-1 text-[var(--fm-text-muted)]">
                        {order.customer.addressLines.length > 0
                          ? order.customer.addressLines.join(", ")
                          : "Address unavailable"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Delivery status</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  {order.status === "CANCELED" || order.status === "EXCEPTION" ? (
                    <OrderStatusBadge status={order.status} />
                  ) : (
                    <div>
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        {deliveryStages.map((stage, index) => (
                          <span
                            className={
                              index <= deliveryStage(order)
                                ? "font-medium text-[var(--fm-text)]"
                                : "text-[var(--fm-text-muted)]"
                            }
                            key={stage}
                          >
                            {stage}
                          </span>
                        ))}
                      </div>
                      <div
                        className="mt-3 grid grid-cols-4 gap-1"
                        role="progressbar"
                        aria-label="Order delivery progress"
                        aria-valuemin={0}
                        aria-valuemax={3}
                        aria-valuenow={deliveryStage(order)}
                      >
                        {deliveryStages.map((stage, index) => (
                          <span
                            className={`h-1.5 rounded-full ${index <= deliveryStage(order) ? "bg-[var(--fm-text)]" : "bg-[var(--fm-border)]"}`}
                            key={stage}
                          />
                        ))}
                      </div>
                      <p className="mt-3 text-sm text-[var(--fm-text-muted)]">
                        {order.delivery?.deliveredAt
                          ? `Delivered ${dateTime(order.delivery.deliveredAt)}`
                          : order.fulfillment?.promisedAt
                            ? `Promised ${dateTime(order.fulfillment.promisedAt)}`
                            : order.fulfillment?.deliveryDate
                              ? `Delivery date ${dateTime(order.fulfillment.deliveryDate)}`
                              : "No delivery promise is available."}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <ListPageSection title="Order items">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item, index) => (
                      <TableRow key={`${item.productName}-${item.variantName}-${index}`}>
                        <TableCell>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            {item.variantName} · {item.baseQuantity} {item.unit.toLowerCase()}
                          </p>
                        </TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{money(item.unitPriceMinor, order.currency)}</TableCell>
                        <TableCell className="font-medium">
                          {money(item.lineTotalMinor, order.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ListPageSection>

              {order.amendments.length > 0 ? (
                <ListPageSection
                  title="Additions"
                  description="Post-payment additions retain independent price and payment history."
                >
                  <div className="divide-y">
                    {order.amendments.map((amendment) => (
                      <article
                        className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
                        key={amendment.amendmentId}
                      >
                        <div>
                          <p className="font-medium">
                            {amendment.lines.length} added item
                            {amendment.lines.length === 1 ? "" : "s"}
                          </p>
                          <p className="font-mono text-xs text-[var(--fm-text-muted)]">
                            {amendment.amendmentId}
                          </p>
                        </div>
                        <div className="text-right">
                          <StatusBadge>{amendment.status}</StatusBadge>
                          <p className="mt-1 font-medium">
                            {money(amendment.totalMinor, amendment.currency)}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </ListPageSection>
              ) : null}

              <ListPageSection title="Timeline">
                <AdminTimeline>
                  {order.timeline.length > 0
                    ? order.timeline.map((entry) => (
                        <li
                          className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr_auto]"
                          key={entry.eventId}
                        >
                          <time className="text-xs text-[var(--fm-text-muted)]">
                            {dateTime(entry.occurredAt)}
                          </time>
                          <span>{entry.label}</span>
                          {entry.status ? <StatusBadge>{entry.status}</StatusBadge> : null}
                        </li>
                      ))
                    : undefined}
                </AdminTimeline>
              </ListPageSection>
            </div>

            <aside className="space-y-6">
              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Order summary</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <dl className="space-y-3">
                    <SummaryRow
                      label={`Subtotal (${order.items.length} items)`}
                      value={money(order.financial.subtotalMinor, order.currency)}
                    />
                    <SummaryRow
                      label="Discount"
                      value={
                        order.financial.discountMinor === null
                          ? "Unavailable"
                          : `−${money(order.financial.discountMinor, order.currency)}`
                      }
                      muted
                    />
                    <SummaryRow
                      label="Delivery"
                      value={money(order.financial.deliveryFeeMinor, order.currency)}
                    />
                    <SummaryRow
                      label="Service fee"
                      value={money(order.financial.serviceFeeMinor, order.currency)}
                    />
                    <SummaryRow
                      label="Tax"
                      value={money(order.financial.taxMinor, order.currency)}
                    />
                  </dl>
                  <Separator className="my-4" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Total</span>
                    <span className="text-lg font-semibold">
                      {money(order.financial.totalMinor, order.currency)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Customer details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-5 text-sm">
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Customer name</p>
                    <p className="mt-1 font-medium">{order.customer.name ?? "Unavailable"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Email</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <a
                        className="min-w-0 truncate hover:underline"
                        href={`mailto:${order.customer.email}`}
                      >
                        {order.customer.email}
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy email"
                        onClick={() => void copy(order.customer.email, "Email")}
                      >
                        <Clipboard aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Phone</p>
                    {order.customer.phone ? (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <a
                          className="inline-flex items-center gap-2 hover:underline"
                          href={`tel:${order.customer.phone}`}
                        >
                          <Phone className="size-3.5" aria-hidden="true" />
                          {order.customer.phone}
                        </a>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Copy phone"
                          onClick={() => void copy(order.customer.phone ?? "", "Phone")}
                        >
                          <Clipboard aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-1 text-[var(--fm-text-muted)]">Unavailable</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-[var(--fm-text-muted)]">Address</p>
                    <p className="mt-1">
                      {order.customer.addressLines.length > 0
                        ? order.customer.addressLines.join(", ")
                        : "Unavailable"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  {order.payments.length === 0 ? (
                    <p className="text-sm text-[var(--fm-text-muted)]">
                      No payment intent is linked.
                    </p>
                  ) : (
                    order.payments.map((payment) => (
                      <div className="space-y-2 text-sm" key={payment.paymentIntentId}>
                        <div className="flex items-center justify-between gap-2">
                          <StatusBadge>{payment.status}</StatusBadge>
                          <span className="font-medium">
                            {money(payment.amountMinor, payment.currency)}
                          </span>
                        </div>
                        <Link
                          className="block truncate font-mono text-xs text-[var(--fm-text-muted)] hover:underline"
                          href={`/admin/payments/transactions/${payment.paymentIntentId}`}
                        >
                          {payment.paymentIntentId}
                        </Link>
                        {payment.refundedMinor > 0 ? (
                          <p className="text-xs text-[var(--fm-text-muted)]">
                            Refunded {money(payment.refundedMinor, payment.currency)}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="px-5">
                  <CardTitle>Fulfillment</CardTitle>
                </CardHeader>
                <CardContent className="px-5">
                  <dl className="space-y-3">
                    <SummaryRow
                      label="Mode"
                      value={order.fulfillmentMode === "INSTANT" ? "Instant" : "Scheduled"}
                    />
                    <SummaryRow label="Status" value={order.fulfillment?.status ?? "Not started"} />
                    <SummaryRow
                      label="Location"
                      value={order.fulfillment?.locationId ?? "Unavailable"}
                    />
                    <SummaryRow label="Delivery" value={order.delivery?.status ?? "Not started"} />
                    <SummaryRow label="Rider" value={order.delivery?.riderUserId ?? "Unassigned"} />
                  </dl>
                </CardContent>
              </Card>

              {customerIssues.length > 0 ? (
                <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                  <CardHeader className="px-5">
                    <CardTitle>Customer issues</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-5">
                    {customerIssues.map((issue) => (
                      <div className="text-sm" key={issue.exceptionId}>
                        <div className="flex items-center justify-between gap-2">
                          <strong>{humanize(issue.kind)}</strong>
                          <OrderIssueStatusBadge status={issue.status} />
                        </div>
                        {issue.details ? (
                          <p className="mt-1 text-[var(--fm-text-muted)]">{issue.details}</p>
                        ) : null}
                        <Button className="mt-2" variant="link" size="sm" asChild>
                          <Link href={`/admin/issues/${issue.exceptionId}`} prefetch={false}>
                            Review issue
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {financeExceptions.length > 0 ? (
                <Card className="gap-4 py-5 shadow-[var(--fm-shadow-card)]">
                  <CardHeader className="px-5">
                    <CardTitle>Payment exceptions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-5">
                    {financeExceptions.map((exception) => (
                      <div className="text-sm" key={exception.exceptionId}>
                        <div className="flex items-center justify-between gap-2">
                          <strong>{humanize(exception.kind)}</strong>
                          <StatusBadge>{humanize(exception.status)}</StatusBadge>
                        </div>
                        {exception.details ? (
                          <p className="mt-1 text-[var(--fm-text-muted)]">{exception.details}</p>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </aside>
          </div>

          <AdminConfirmationDialog
            open={confirming}
            title="Confirm order cancellation"
            resource={`Order ${order.orderNumber ?? order.orderId} · ${money(order.totalMinor, order.currency)}`}
            scope="Core-authorized order scope"
            consequence="Cancellation is a lifecycle transition and may initiate refund handling; it cannot be treated as an arbitrary edit."
            pending={cancelIntent.pending}
            onCancel={() => setConfirming(false)}
            onConfirm={(confirmedReason) => void cancel(confirmedReason)}
          />
        </>
      ) : null}
    </div>
  );
}
