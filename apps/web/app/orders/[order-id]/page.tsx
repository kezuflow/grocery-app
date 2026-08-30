"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { CustomerOrderDetailView, RpcResult } from "@freshmarkets/contracts";
import { StorefrontShell } from "../../../components/storefront/storefront-shell";
import { OrderTimeline } from "../../../components/storefront/orders/order-timeline";
import { ReorderAction } from "../../../components/storefront/orders/reorder-action";
import { OrderIssueForm } from "../../../components/storefront/orders/order-issue-form";
import { AmendmentFlow } from "../../../components/storefront/orders/amendment-flow";

function money(value: number | null, currency: string): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

function label(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function OrderDetailContent({ order }: { order: CustomerOrderDetailView }) {
  const reorderAction = order.actions.find((action) => action.action === "REORDER");
  const issueAction = order.actions.find((action) => action.action === "SUBMIT_ISSUE");
  const amendmentAction = order.actions.find((action) => action.action === "REQUEST_AMENDMENT");
  const address = order.fulfillment.address;
  const addressLine = [
    address.addressLine1,
    address.addressLine2,
    address.barangay,
    address.city,
    address.region,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const financialRows: Array<[string, number | null]> = [
    ["Merchandise subtotal", order.financial.merchandiseSubtotalMinor],
    ["Item discounts", order.financial.itemDiscountMinor],
    ["Order promotion", order.financial.orderDiscountMinor],
    ["Delivery subtotal", order.financial.deliverySubtotalMinor],
    ["Delivery promotion", order.financial.deliveryDiscountMinor],
    ["Delivery fee", order.financial.deliveryFeeMinor],
    ["Service fee", order.financial.serviceFeeMinor],
    ["Tax", order.financial.taxMinor],
  ];

  return (
    <div className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <Link href="/orders" className="text-sm font-semibold underline underline-offset-4">
        Back to orders
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Order {order.orderNumber}
          </p>
          <h1 className="mt-1 text-3xl font-bold">{label(order.status)}</h1>
          <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
            Confirmed {new Date(order.committedAt).toLocaleString()}
          </p>
        </div>
        <span className="rounded-full bg-[var(--fm-surface-soft)] px-3 py-2 text-sm font-semibold">
          {label(order.fulfillment.mode)}
        </span>
      </div>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
            aria-labelledby="order-items-heading"
          >
            <h2 id="order-items-heading" className="text-xl font-bold">
              Items
            </h2>
            <ul className="mt-4 divide-y divide-[var(--fm-border)]">
              {order.items.map((item) => (
                <li key={item.orderItemId} className="flex justify-between gap-4 py-3 text-sm">
                  <span>
                    <strong>{item.productName}</strong>
                    <span className="block text-[var(--fm-text-muted)]">
                      {item.variantName} · {item.quantity} × {item.unit}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {money(item.lineTotalMinor, order.financial.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
            aria-labelledby="delivery-heading"
          >
            <h2 id="delivery-heading" className="text-xl font-bold">
              Delivery
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--fm-text-muted)]">Promise</dt>
                <dd className="font-semibold">
                  {order.fulfillment.mode === "INSTANT"
                    ? order.fulfillment.promisedAt
                      ? new Date(order.fulfillment.promisedAt).toLocaleString()
                      : "Unavailable"
                    : order.fulfillment.deliveryDate
                      ? new Date(order.fulfillment.deliveryDate).toLocaleDateString()
                      : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Progress</dt>
                <dd className="font-semibold">
                  {order.fulfillment.deliveryStatus
                    ? label(order.fulfillment.deliveryStatus)
                    : "Preparing"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--fm-text-muted)]">Address snapshot</dt>
                <dd className="font-semibold">{addressLine || "Unavailable"}</dd>
                {address.recipient ? (
                  <p>
                    {address.recipient}
                    {address.phone ? ` · ${address.phone}` : ""}
                  </p>
                ) : null}
                {address.deliveryNote ? (
                  <p className="mt-1 text-[var(--fm-text-muted)]">{address.deliveryNote}</p>
                ) : null}
              </div>
            </dl>
          </section>

          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
            aria-labelledby="follow-up-heading"
          >
            <h2 id="follow-up-heading" className="text-xl font-bold">
              Order follow-up
            </h2>
            {reorderAction ? (
              <div className="mt-4">
                <ReorderAction orderId={order.orderId} available={reorderAction.available} />
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {order.actions
                .filter(
                  (action) =>
                    !["REORDER", "SUBMIT_ISSUE", "REQUEST_AMENDMENT"].includes(action.action),
                )
                .map((action) => (
                  <div
                    key={action.action}
                    className="rounded-lg border border-[var(--fm-border)] p-3 text-sm"
                  >
                    <p className="font-semibold">{label(action.action)}</p>
                    <p className="mt-1 text-[var(--fm-text-muted)]">
                      {action.available
                        ? "Available for this order"
                        : label(action.disabledReason ?? "Unavailable")}
                    </p>
                  </div>
                ))}
            </div>
            {issueAction ? (
              <OrderIssueForm
                orderId={order.orderId}
                items={order.items}
                available={issueAction.available}
              />
            ) : null}
            {amendmentAction ? (
              <AmendmentFlow
                orderId={order.orderId}
                orderVersion={order.version}
                available={amendmentAction.available}
              />
            ) : null}
          </section>

          {order.amendments.length ? (
            <section
              aria-labelledby="amendments-heading"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
            >
              <h2 id="amendments-heading" className="text-xl font-bold">
                Order additions
              </h2>
              <ul className="mt-3 space-y-2">
                {order.amendments.map((amendment) => (
                  <li key={amendment.amendmentId} className="flex justify-between gap-4 text-sm">
                    <span>{label(amendment.status)}</span>
                    <span>
                      {money(amendment.financial.totalMinor, amendment.financial.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {order.issues.length ? (
            <section
              aria-labelledby="issues-heading"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
            >
              <h2 id="issues-heading" className="text-xl font-bold">
                Reported issues
              </h2>
              <ul className="mt-3 space-y-3">
                {order.issues.map((issue) => (
                  <li key={issue.issueId} className="text-sm">
                    <strong>{label(issue.category)}</strong> · {label(issue.status)}
                    <p className="mt-1 text-[var(--fm-text-muted)]">{issue.description}</p>
                    {issue.resolutionMessage ? (
                      <p className="mt-1">{issue.resolutionMessage}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6">
            <OrderTimeline entries={order.timeline} />
          </div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24">
          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5"
            aria-labelledby="totals-heading"
          >
            <h2 id="totals-heading" className="text-xl font-bold">
              Totals
            </h2>
            {order.financial.source === "ORDER_TOTAL_ONLY" ? (
              <p role="status" className="mt-3 text-sm text-[var(--fm-text-muted)]">
                A component breakdown is unavailable for this historical order.
              </p>
            ) : null}
            <dl className="mt-4 space-y-2 text-sm">
              {financialRows.map(([name, value]) => (
                <div key={name} className="flex justify-between gap-3">
                  <dt>{name}</dt>
                  <dd className="tabular-nums">{money(value, order.financial.currency)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-[var(--fm-border)] pt-3 text-base font-bold">
                <dt>Total</dt>
                <dd>{money(order.financial.totalMinor, order.financial.currency)}</dd>
              </div>
            </dl>
          </section>
          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5"
            aria-labelledby="payment-heading"
          >
            <h2 id="payment-heading" className="text-xl font-bold">
              Payment
            </h2>
            {order.payments.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {order.payments.map((payment) => (
                  <li key={payment.paymentId} className="flex justify-between gap-3">
                    <span>{label(payment.status)}</span>
                    <span>{money(payment.amountMinor, payment.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--fm-text-muted)]">
                Payment history is unavailable.
              </p>
            )}
            {order.refunds.length ? (
              <p className="mt-3 text-sm">
                Refunds:{" "}
                {order.refunds
                  .map(
                    (refund) =>
                      `${money(refund.amountMinor, refund.currency)} ${label(refund.status)}`,
                  )
                  .join(", ")}
              </p>
            ) : null}
          </section>
          <section
            className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5"
            aria-labelledby="invoice-heading"
          >
            <h2 id="invoice-heading" className="text-xl font-bold">
              Invoice
            </h2>
            <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
              {order.invoice.status === "ISSUED"
                ? `Invoice ${order.invoice.invoiceIdentifier ?? "issued"}`
                : "An invoice is not yet available for this order."}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function CustomerOrderDetailPage() {
  const orderId = useParams<{ "order-id": string }>()?.["order-id"];
  const [state, setState] = useState<
    "loading" | "ready" | "not-found" | "unauthenticated" | "error"
  >("loading");
  const [order, setOrder] = useState<CustomerOrderDetailView | null>(null);

  useEffect(() => {
    if (!orderId) {
      setState("not-found");
      return;
    }
    let active = true;
    void fetch(`/api/commerce/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => response.json() as Promise<RpcResult<CustomerOrderDetailView>>)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setOrder(result.value);
          setState("ready");
          return;
        }
        setState(
          result.error.code === "NOT_FOUND"
            ? "not-found"
            : result.error.code === "UNAUTHENTICATED"
              ? "unauthenticated"
              : "error",
        );
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [orderId]);

  return (
    <StorefrontShell>
      {state === "loading" ? (
        <p role="status" className="p-8">
          Loading order details…
        </p>
      ) : null}
      {state === "unauthenticated" ? (
        <div className="p-8">
          <p>Sign in to view this order.</p>
          <Link href="/auth/login?returnTo=/orders" className="underline">
            Sign in
          </Link>
        </div>
      ) : null}
      {state === "not-found" ? (
        <div className="p-8">
          <h1 className="text-2xl font-bold">Order not found</h1>
          <p className="mt-2">This order is unavailable or does not belong to this account.</p>
        </div>
      ) : null}
      {state === "error" ? (
        <div role="alert" className="p-8">
          <h1 className="text-2xl font-bold">Order details unavailable</h1>
          <p className="mt-2">Try again from your orders list.</p>
        </div>
      ) : null}
      {state === "ready" && order ? <OrderDetailContent order={order} /> : null}
    </StorefrontShell>
  );
}
