"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CartView } from "@freshmarkets/contracts";
const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/commerce/cart");
    const result = (await response.json()) as {
      ok: boolean;
      value?: CartView;
      error?: { message: string };
    };
    setCart(result.value ?? null);
    setError(result.ok ? "" : (result.error?.message ?? "Unable to load cart."));
  }
  useEffect(() => {
    void load();
  }, []);
  async function update(skuId: string, quantity: number) {
    await fetch("/api/commerce/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skuId, quantity }),
    });
    await load();
  }
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm underline">
        Continue shopping
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Cart</h1>
      {error ? <p className="mt-4 text-red-700">{error}</p> : null}
      <div className="mt-6 divide-y rounded-lg border bg-white">
        {cart?.items.map((item) => (
          <div key={item.skuId} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="text-sm text-slate-600">{money(item.unitPriceMinor)} each</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                aria-label="Decrease quantity"
                className="rounded border px-3 py-1"
                onClick={() => update(item.skuId, item.quantity - 1)}
              >
                −
              </button>
              <span>{item.quantity}</span>
              <button
                aria-label="Increase quantity"
                className="rounded border px-3 py-1"
                onClick={() => update(item.skuId, item.quantity + 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <strong>Total {money(cart?.totalMinor ?? 0)}</strong>
        <Link href="/checkout" className="rounded bg-emerald-700 px-5 py-3 font-medium text-white">
          Checkout
        </Link>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Minimum merchandise total is ₱500. Checkout revalidates prices and availability.
      </p>
    </main>
  );
}
