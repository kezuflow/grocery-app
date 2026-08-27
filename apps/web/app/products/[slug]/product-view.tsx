"use client";

import { useEffect, useState } from "react";
import type { MarketplaceProductView } from "@freshmarkets/contracts";
import { Minus, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ProductMedia } from "../../../components/storefront/catalog-components";
import { toPresentationProduct } from "../../../lib/storefront/catalog-presentation";
import { addToCart, announceToast } from "../../../lib/storefront/cart-client";

export function ProductView({ slug }: { slug: string }) {
  const [view, setView] = useState<MarketplaceProductView | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setStatus("");
    void fetch(`/api/catalog/product?slug=${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then(
        (response) => response.json() as Promise<{ ok?: boolean; value?: MarketplaceProductView }>,
      )
      .then((result) => {
        const nextView = result.value ?? null;
        setView(nextView);
        setSelectedVariantId(nextView?.product.variants[0]?.id ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setView(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  if (loading) {
    return (
      <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]" aria-label="Loading product">
        <div className="aspect-square animate-pulse rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-muted)]" />
        <div className="space-y-4 py-4">
          <div className="h-4 w-24 animate-pulse rounded bg-[var(--fm-surface-muted)]" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-[var(--fm-surface-muted)]" />
          <div className="h-16 w-full animate-pulse rounded bg-[var(--fm-surface-muted)]" />
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div role="alert" className="border-y border-[var(--fm-border)] py-16 text-center">
        <h2 className="font-semibold">Product unavailable</h2>
        <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
          This grocery could not be loaded.
        </p>
      </div>
    );
  }

  const product = view.product;

  const selectedVariant =
    product.variants.find((variant) => variant.id === selectedVariantId) ?? product.variants[0];
  const selectedPrice = selectedVariant?.priceMinor ?? null;

  async function add() {
    if (!selectedVariant || selectedPrice === null || !product.available) return;
    setStatus("");
    const result = await addToCart(selectedVariant.id, quantity);
    if (result.ok) {
      setStatus(`${quantity} × ${product.name} added to cart.`);
      return;
    }
    if (result.reason === "unauthenticated") {
      announceToast({
        message: "Sign in to add items to your cart.",
        tone: "error",
        signInHref: "/auth/login",
      });
      setStatus("Sign in to add items to your cart.");
      return;
    }
    setStatus(result.message);
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
      <div className="rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-6">
        <ProductMedia image={toPresentationProduct(view.product).image} name={view.product.name} />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--fm-primary-dark)]">
          {view.product.category.name}
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.03em]">{view.product.name}</h1>
        <p className="mt-3 text-[var(--fm-text-muted)]">{view.product.description}</p>
        <fieldset className="mt-6 space-y-3">
          <legend className="text-sm font-semibold">Choose a fixed pack</legend>
          {view.product.variants.map((variant) => (
            <label
              key={variant.id}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-4 has-[:checked]:border-[var(--fm-primary-dark)] has-[:checked]:bg-[var(--fm-surface-soft)]"
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="product-variant"
                  value={variant.id}
                  checked={selectedVariant?.id === variant.id}
                  onChange={() => setSelectedVariantId(variant.id)}
                  className="size-4 accent-[var(--fm-primary-dark)]"
                />
                <span>
                  <span className="block font-semibold">{variant.name}</span>
                  <span className="block text-xs text-[var(--fm-text-muted)]">
                    Fixed pack · {variant.consumptionBaseQuantity} base units
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right font-semibold">
                {variant.priceMinor === null
                  ? "Unavailable"
                  : new Intl.NumberFormat("en-PH", {
                      style: "currency",
                      currency: variant.currency ?? "PHP",
                    }).format(variant.priceMinor / 100)}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              Quantity
            </p>
            <div className="mt-2 inline-flex items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                className="inline-flex size-10 items-center justify-center hover:bg-[var(--fm-hover)]"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <span
                className="min-w-10 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((current) => Math.min(99, current + 1))}
                className="inline-flex size-10 items-center justify-center hover:bg-[var(--fm-hover)]"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void add()}
            disabled={!selectedVariant || selectedPrice === null || !view.product.available}
          >
            Add to cart
          </Button>
        </div>
        {status ? (
          <p role="status" className="mt-5 text-sm text-[var(--fm-text-muted)]">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
