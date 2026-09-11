"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { customerOrderHistoryStates, type CustomerOrderView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
const ordersResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          orderNumber: z.string(),
          status: z.enum(customerOrderHistoryStates),
          fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
          deliveryDate: z.string().nullable(),
          promisedAt: z.string().nullable(),
          committedAt: z.string(),
          totalMinor: z.number().int(),
          currency: z.string(),
          itemCount: z.number().int(),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);
export default function OrdersPage() {
  const [orders, setOrders] = useState<ReadonlyArray<CustomerOrderView>>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [authRequired, setAuthRequired] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ filter });
    if (cursor) params.set("cursor", cursor);
    setLoading(true);
    setFailed(false);
    if (!cursor) setOrders([]);
    void fetch(`/api/commerce/orders?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((result: unknown) => {
        if (controller.signal.aborted) return;
        const payload = ordersResultSchema.parse(result);
        setAuthRequired(!payload.ok && payload.error.code === "UNAUTHENTICATED");
        if (!payload.ok) {
          setFailed(payload.error.code !== "UNAUTHENTICATED");
          return;
        }
        setOrders((previous) =>
          cursor
            ? [
                ...previous,
                ...payload.value.items.filter(
                  (item) => !previous.some((order) => order.id === item.id),
                ),
              ]
            : payload.value.items,
        );
        setNextCursor(payload.value.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, cursor, retry]);
  return (
    <StorefrontShell>
      <div className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <h1 className="text-3xl font-semibold">Orders</h1>
        {authRequired ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
            <p className="font-medium">Sign in to view your orders.</p>
            <Link href="/auth/login?returnTo=/orders" className="mt-3 inline-flex underline">
              Sign in
            </Link>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Order filters">
          {(["all", "active", "completed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => {
                setCursor(undefined);
                setNextCursor(null);
                setFilter(value);
              }}
              className={`rounded-full border px-4 py-2 text-sm font-medium ${filter === value ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${encodeURIComponent(order.id)}`}
              className="block rounded-lg border bg-white p-5 transition-colors hover:border-[var(--fm-primary-dark)] hover:bg-[var(--fm-surface-soft)]"
              aria-label={`View order ${order.orderNumber}`}
            >
              <div className="flex justify-between gap-4">
                <strong>{order.orderNumber}</strong>
                <span>{order.status}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {order.itemCount} items ·{" "}
                {(order.totalMinor / 100).toLocaleString("en-PH", {
                  style: "currency",
                  currency: order.currency,
                })}{" "}
                ·{" "}
                {order.fulfillmentMode === "INSTANT"
                  ? "Instant delivery"
                  : `delivery ${order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : "date unavailable"}`}
              </p>
            </Link>
          ))}
          {loading ? <p role="status">Loading orders…</p> : null}
          {failed ? (
            <div role="alert">
              <p>Orders could not be loaded.</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                Try again
              </button>
            </div>
          ) : null}
          {!loading && !failed && !authRequired && nextCursor ? (
            <button
              type="button"
              className="rounded border px-4 py-3"
              onClick={() => setCursor(nextCursor)}
            >
              Load more orders
            </button>
          ) : null}
          {orders.length === 0 && !authRequired && !loading && !failed ? (
            <p className="rounded border bg-white p-6 text-slate-600">
              No orders in this view yet.
            </p>
          ) : null}
        </div>
      </div>
    </StorefrontShell>
  );
}
