"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CatalogProduct, CatalogSearchPage } from "@freshmarkets/contracts";

function money(amount: number | null, currency: string | null) {
  if (amount === null || !currency) return "Unavailable";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount / 100);
}

const images: Record<string, string> = {
  "red-onion":
    "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=900&q=80",
  "farm-eggs":
    "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=900&q=80",
};

export function MarketplaceCatalog() {
  const [items, setItems] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [loading, setLoading] = useState(true);

  async function load(query = "") {
    setLoading(true);
    const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`);
    const result = (await response.json()) as { ok: boolean; value?: CatalogSearchPage };
    setItems(result.value?.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "");
    void load(query);
  }

  return (
    <>
      <form onSubmit={search} className="flex w-full max-w-xl gap-2">
        <input
          name="query"
          aria-label="Search groceries"
          placeholder="Search fresh groceries"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3"
        />
        <button className="rounded-md bg-emerald-700 px-5 py-3 font-medium text-white">
          Search
        </button>
      </form>
      {loading ? <p className="text-sm text-slate-600">Loading groceries...</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {items.map((product) => (
          <article
            key={product.id}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            <img
              src={images[product.slug]}
              alt={product.name}
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="p-4">
              <p className="text-xs font-semibold uppercase text-emerald-700">
                {product.category.name}
              </p>
              <h2 className="mt-1 text-lg font-semibold">{product.name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {product.variants[0]
                  ? `From ${money(product.variants[0].priceMinor, product.variants[0].currency)}`
                  : "Unavailable"}
              </p>
              <a
                href={`/products/${product.slug}`}
                className="mt-4 inline-flex text-sm font-semibold text-emerald-800"
              >
                View options
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
