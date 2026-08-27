"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CustomerOrderView } from "@freshmarkets/contracts";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
export default function OrdersPage() {
  const [orders, setOrders] = useState<ReadonlyArray<CustomerOrderView>>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [authRequired, setAuthRequired] = useState(false);
  useEffect(() => {
    void fetch("/api/commerce/orders")
      .then((r) => r.json())
      .then((result: unknown) => {
        const payload = result as {
          ok?: boolean;
          value?: ReadonlyArray<CustomerOrderView>;
          error?: { code?: string };
        };
        setAuthRequired(payload.error?.code === "UNAUTHENTICATED");
        setOrders(payload.value ?? []);
      })
      .catch(() => setOrders([]));
  }, []);
  const visibleOrders = orders.filter((order) => {
    if (filter === "all") return true;
    const completed =
      order.status === "DELIVERED" || order.status === "CANCELED" || order.status === "REFUNDED";
    return filter === "completed" ? completed : !completed;
  });
  return (
    <StorefrontShell>
      <div className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <Link href="/account" className="text-sm underline">
          Account
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">Orders</h1>
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
              onClick={() => setFilter(value)}
              className={`rounded-full border px-4 py-2 text-sm font-medium ${filter === value ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3">
          {visibleOrders.map((order) => (
            <article key={order.id} className="rounded-lg border bg-white p-5">
              <div className="flex justify-between gap-4">
                <strong>{order.id}</strong>
                <span>{order.status}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {order.itemCount} items ·{" "}
                {(order.totalMinor / 100).toLocaleString("en-PH", {
                  style: "currency",
                  currency: order.currency,
                })}{" "}
                · delivery {new Date(order.deliveryDate).toLocaleDateString()}
              </p>
            </article>
          ))}
          {visibleOrders.length === 0 && !authRequired ? (
            <p className="rounded border bg-white p-6 text-slate-600">
              No orders in this view yet.
            </p>
          ) : null}
        </div>
      </div>
    </StorefrontShell>
  );
}
