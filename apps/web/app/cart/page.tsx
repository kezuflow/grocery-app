"use client";
import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { useEffect, useState } from "react";
import type { CartView } from "@freshmarkets/contracts";
import { addToCart, cartCountFromView, fetchCart } from "../../lib/storefront/cart-client";
import { StorefrontShell } from "../../components/storefront/storefront-shell";
import { OrderSummary } from "../../components/storefront/marketplace/order-summary";
import { CheckoutAuthDialog } from "../../components/storefront/marketplace/checkout-auth-dialog";

const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);

export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const next = await fetchCart();
      setCart(next);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function update(item: CartView["items"][number], quantity: number) {
    const result = await addToCart(item.skuId, quantity, {
      name: item.name,
      unitPriceMinor: item.unitPriceMinor,
      currency: cart?.currency ?? "PHP",
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError("");
    await load();
  }
  const guest = cart?.id === "guest-cart";
  const count = cart ? cartCountFromView(cart) : 0;
  const canCheckout = Boolean(cart?.items.length);
  return (
    <StorefrontShell>
      <div className="min-h-[100dvh] w-full px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
          >
            Continue shopping
          </Link>
          <span className="text-xs text-[var(--fm-text-muted)]">
            {count} {count === 1 ? "item" : "items"} saved for this browser
          </span>
        </div>
        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section aria-label="Cart items" className="min-w-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                Basket
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em]">Cart</h1>
              <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
                Review your fresh picks before choosing delivery.
              </p>
            </div>
            {error ? (
              <p
                role="alert"
                className="mt-5 rounded-[var(--fm-radius-control)] bg-[var(--fm-danger-soft)] p-3 text-sm text-[var(--fm-destructive)]"
              >
                {error}
              </p>
            ) : null}
            {loading ? (
              <div className="mt-6 space-y-3" aria-label="Loading cart">
                {[0, 1].map((item) => (
                  <div
                    key={item}
                    className="h-28 animate-pulse rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-muted)]"
                  />
                ))}
              </div>
            ) : !cart?.items.length ? (
              <div className="mt-6 flex min-h-72 flex-col items-center justify-center rounded-[var(--fm-radius-surface)] border border-dashed border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-white text-[var(--fm-primary-dark)] shadow-sm">
                  <ShoppingBasket className="size-7" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-xl font-bold">Your cart is empty</h2>
                <p className="mt-1 max-w-sm text-sm text-[var(--fm-text-muted)]">
                  Add something fresh and it will stay saved while you browse.
                </p>
              </div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white">
                {cart.items.map((item) => (
                  <div
                    key={item.skuId}
                    className="flex gap-4 border-b border-[var(--fm-border)] p-4 last:border-b-0 sm:p-5"
                  >
                    <div className="flex size-20 shrink-0 items-center justify-center rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]">
                      <ShoppingBasket className="size-7" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold">{item.name}</p>
                      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                        {money(item.unitPriceMinor)} each · fixed pack
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="inline-flex h-10 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
                          <button
                            aria-label={`Decrease ${item.name}`}
                            className="inline-flex size-10 items-center justify-center rounded-l-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
                            onClick={() => void update(item, item.quantity - 1)}
                          >
                            −
                          </button>
                          <span className="min-w-9 text-center text-sm font-semibold tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            aria-label={`Increase ${item.name}`}
                            className="inline-flex size-10 items-center justify-center rounded-r-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
                            onClick={() => void update(item, item.quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                        <strong className="tabular-nums">{money(item.lineTotalMinor)}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="lg:sticky lg:top-24">
            <OrderSummary
              cart={cart}
              actionLabel={
                !canCheckout ? "Continue shopping" : guest ? "Sign in to checkout" : "Checkout"
              }
              actionHref={!canCheckout ? "/" : guest ? undefined : "/checkout"}
              onAction={guest && canCheckout ? () => setAuthOpen(true) : undefined}
              disabled={loading}
              note="Minimum order, availability, and delivery are confirmed at checkout."
            />
          </div>
        </div>
        {authOpen ? <CheckoutAuthDialog onClose={() => setAuthOpen(false)} /> : null}
      </div>
    </StorefrontShell>
  );
}
