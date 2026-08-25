"use client";

import { useEffect, useState } from "react";
import type { MarketplaceProductView } from "@freshmarkets/contracts";

export function ProductView({ slug }: { slug: string }) {
  const [view, setView] = useState<MarketplaceProductView | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void fetch(`/api/catalog/product?slug=${encodeURIComponent(slug)}`)
      .then((response) => response.json() as Promise<{ value?: MarketplaceProductView }>)
      .then((result) => setView(result.value ?? null));
  }, [slug]);
  if (!view) return <p className="text-sm text-slate-600">Loading product...</p>;
  async function add(skuId: string) {
    const response = await fetch("/api/commerce/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skuId, quantity: 1 }),
    });
    const result = (await response.json()) as { ok: boolean; error?: { message: string } };
    setStatus(result.ok ? "Added to cart." : (result.error?.message ?? "Sign in to add items."));
  }
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
      <img
        src={
          slug === "farm-eggs"
            ? "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=1000&q=85"
            : "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=1000&q=85"
        }
        alt={view.product.name}
        className="aspect-square w-full rounded-lg object-cover"
      />
      <div>
        <p className="text-sm font-semibold uppercase text-emerald-700">
          {view.product.category.name}
        </p>
        <h1 className="mt-2 text-4xl font-bold">{view.product.name}</h1>
        <p className="mt-3 text-slate-600">{view.product.description}</p>
        <div className="mt-6 space-y-3">
          {view.product.variants.map((variant) => (
            <div
              key={variant.id}
              className="flex items-center justify-between rounded-lg border bg-white p-4"
            >
              <div>
                <p className="font-semibold">{variant.name}</p>
                <p className="text-xs text-slate-500">
                  Fixed pack · {variant.consumptionBaseQuantity} base units
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {variant.priceMinor === null
                    ? "Unavailable"
                    : new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: variant.currency ?? "PHP",
                      }).format(variant.priceMinor / 100)}
                </p>
                <button
                  onClick={() => add(variant.id)}
                  className="mt-2 rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white"
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
        {status ? (
          <p role="status" className="mt-5 text-sm text-slate-600">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
