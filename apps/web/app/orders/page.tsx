"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CustomerOrderView } from "@freshmarkets/contracts";
export default function OrdersPage() {
  const [orders, setOrders] = useState<ReadonlyArray<CustomerOrderView>>([]);
  useEffect(() => {
    void fetch("/api/commerce/orders")
      .then((r) => r.json())
      .then((result: unknown) =>
        setOrders((result as { value?: ReadonlyArray<CustomerOrderView> }).value ?? []),
      );
  }, []);
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/account" className="text-sm underline">
        Account
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Orders</h1>
      <div className="mt-6 grid gap-3">
        {orders.map((order) => (
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
        {orders.length === 0 ? (
          <p className="rounded border bg-white p-6 text-slate-600">No committed orders yet.</p>
        ) : null}
      </div>
    </main>
  );
}
