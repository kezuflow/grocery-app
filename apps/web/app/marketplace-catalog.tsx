"use client";

import { useEffect, useState } from "react";
import type { CatalogProduct, CatalogSearchPage } from "@freshmarkets/contracts";
import {
  CatalogCategoryRail,
  ProductGrid,
  categoryMatches,
} from "../components/storefront/catalog-components";

export function MarketplaceCatalog({
  query = "",
  category = "all",
}: {
  query?: string;
  category?: string;
}) {
  const [items, setItems] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Catalog request failed");
        const result = (await response.json()) as {
          ok: boolean;
          value?: CatalogSearchPage;
          error?: { message?: string };
        };
        if (!result.ok) throw new Error(result.error?.message ?? "Unable to load groceries");
        setItems(result.value?.items ?? []);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setItems([]);
        setError(cause instanceof Error ? cause.message : "Unable to load groceries");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [query]);
  const visibleCount = items.filter((product) => categoryMatches(product, category)).length;
  return (
    <div className="space-y-5">
      <CatalogCategoryRail active={category} />
      <div className="flex items-end justify-between gap-4 border-t border-[var(--fm-border)] pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            {query ? "Search results" : "Marketplace"}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] sm:text-2xl">
            {query
              ? `Results for “${query}”`
              : category === "all"
                ? "Fresh this week"
                : "Browse category"}
          </h2>
        </div>
        {!loading && !error ? (
          <p className="shrink-0 text-xs text-[var(--fm-text-muted)]">
            {visibleCount} {visibleCount === 1 ? "product" : "products"}
          </p>
        ) : null}
      </div>
      {loading ? <CatalogSkeleton /> : null}
      {error ? <CatalogError message={error} /> : null}
      {!loading && !error ? (
        <ProductGrid products={items} category={category} query={query} />
      ) : null}
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div
      aria-label="Loading groceries"
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="animate-pulse">
          <div className="aspect-square rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-muted)]" />
          <div className="mt-3 h-4 w-20 rounded bg-[var(--fm-surface-muted)]" />
          <div className="mt-2 h-4 w-3/4 rounded bg-[var(--fm-surface-muted)]" />
          <div className="mt-2 h-3 w-1/2 rounded bg-[var(--fm-surface-muted)]" />
        </div>
      ))}
    </div>
  );
}
function CatalogError({ message }: { message: string }) {
  return (
    <div role="alert" className="border-y border-[var(--fm-border)] py-12 text-center">
      <h3 className="font-semibold">Groceries could not be loaded</h3>
      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">{message}</p>
      <button
        type="button"
        onClick={() => location.reload()}
        className="mt-4 text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
      >
        Try again
      </button>
    </div>
  );
}
