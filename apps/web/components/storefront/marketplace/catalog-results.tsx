"use client";

import { useCallback, useState } from "react";
import type { CatalogProduct, CatalogSearchPage } from "@freshmarkets/contracts";
import {
  toPresentationProducts,
  type PresentationProduct,
} from "../../../lib/storefront/catalog-presentation";
import { ProductGrid } from "../catalog-components";
import {
  appendUniqueProducts,
  loadMoreAnnouncement,
} from "../../../lib/storefront/storefront-pagination";

/**
 * Progressive category/search result list. The server renders the first page
 * through Core's paginated search; this boundary appends cursor pages from
 * /api/catalog without ever client-filtering a truncated global list.
 */
export function CatalogResults({
  initialItems,
  initialCursor,
  query = "",
  categorySlug,
  locationId,
}: {
  initialItems: ReadonlyArray<PresentationProduct>;
  initialCursor: string | null;
  query?: string;
  categorySlug?: string;
  locationId?: string;
}) {
  const [items, setItems] = useState<PresentationProduct[]>([...initialItems]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (query.trim() !== "") params.set("q", query.trim());
      if (categorySlug) params.set("category", categorySlug);
      if (locationId) params.set("locationId", locationId);
      params.set("cursor", cursor);
      params.set("limit", "24");
      const response = await fetch(`/api/catalog?${params.toString()}`);
      const payload = (await response.json()) as
        | { ok: true; value: CatalogSearchPage }
        | { ok: false };
      if (!payload.ok) throw new Error("catalog request failed");
      const converted = toPresentationProducts(
        payload.value.items as ReadonlyArray<CatalogProduct>,
      );
      setItems((current) => appendUniqueProducts(current, converted));
      setAnnouncement(
        loadMoreAnnouncement({
          added: converted.length,
          totalShown: items.length + converted.length,
        }),
      );
      setCursor(payload.value.nextCursor);
    } catch {
      setError(true);
      setAnnouncement("Could not load more products. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, query, categorySlug, locationId, items.length]);

  return (
    <div>
      <ProductGrid products={items} />
      <p role="status" aria-live="polite" className="sr-only">
        {items.length} products shown.
        {announcement ? ` ${announcement}` : ""}
      </p>
      <p className="mt-6 text-center text-xs text-[var(--fm-text-muted)]" aria-hidden="true">
        Showing {items.length} {items.length === 1 ? "product" : "products"}
      </p>
      <div className="mt-4 flex justify-center">
        {error ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-5 text-sm font-semibold text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)]"
          >
            Try again
          </button>
        ) : cursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            data-testid="load-more"
            className="inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-6 text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more groceries"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
