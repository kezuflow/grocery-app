"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CartView } from "@freshmarkets/contracts";
import {
  CART_CHANGED_EVENT,
  addToCart,
  cartCountFromView,
  fetchCart,
} from "../../lib/storefront/cart-client";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState("");
  async function load() {
    const next = await fetchCart();
    setCart(next);
    setError(next ? "" : "Unable to load your cart right now.");
  }
  useEffect(() => {
    void load();
    const onCartChanged = () => void load();
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
  }, []);
  async function update(item: CartView["items"][number], quantity: number) {
    const result = await addToCart(item.skuId, quantity, {
      name: item.name,
      unitPriceMinor: item.unitPriceMinor,
      currency: cart?.currency ?? "PHP",
    });
    if (!result.ok) setError(result.message);
    await load();
  }
  const guest = cart?.id === "guest-cart";
  const count = cart ? cartCountFromView(cart) : 0;
  return (
    <StorefrontShell>
      <div className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <Link href="/" className="text-sm underline">
          Continue shopping
        </Link>
        <h1 className="mt-6 text-3xl font-semibold">Cart</h1>
        <p className="mt-2 text-sm text-slate-600">
          {count} {count === 1 ? "item" : "items"} saved for this browser.
        </p>
        {error ? <p className="mt-4 text-red-700">{error}</p> : null}
        <div className="mt-6 divide-y rounded-lg border bg-white">
          {cart?.items.map((item) => (
            <div key={item.skuId} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-slate-600">
                  {money(item.unitPriceMinor)} each · fixed pack
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Decrease quantity"
                  className="rounded border px-3 py-1"
                  onClick={() => void update(item, item.quantity - 1)}
                >
                  −
                </button>
                <span>{item.quantity}</span>
                <button
                  aria-label="Increase quantity"
                  className="rounded border px-3 py-1"
                  onClick={() => void update(item, item.quantity + 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <strong>Total {money(cart?.totalMinor ?? 0)}</strong>
          <Link
            href={guest ? "/auth/login?returnTo=/checkout" : "/checkout"}
            className="rounded bg-emerald-700 px-5 py-3 font-medium text-white"
          >
            {guest ? "Sign in to checkout" : "Checkout"}
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          The minimum order is confirmed from the current delivery configuration at checkout.
          Prices, availability, and serviceability are revalidated before payment.
        </p>
      </div>
    </StorefrontShell>
  );
}
