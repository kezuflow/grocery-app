"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useQueryEpoch } from "../../../components/query-provider";
import {
  fetchCatalogPage,
  type CatalogPresentationPage,
  type CatalogSelection,
} from "../../../lib/query/catalog";
import { queryKeys } from "../../../lib/query/query-client";
import { appendUniqueProducts } from "../../../lib/storefront/storefront-pagination";
import { ProductGrid, ProductGridEmpty } from "../catalog-components";
import { QuickViewProvider } from "./quick-view-provider";

export function CatalogResults({
  selection,
  initialPage,
}: {
  selection: CatalogSelection;
  initialPage?: CatalogPresentationPage;
}) {
  const epoch = useQueryEpoch();
  const result = useInfiniteQuery({
    queryKey: queryKeys.catalog(epoch, selection.query, selection.category),
    queryFn: ({ pageParam, signal }) =>
      fetchCatalogPage({ ...selection, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    initialData:
      initialPage && epoch === 0 ? { pages: [initialPage], pageParams: [null] } : undefined,
  });
  const items = useMemo(
    () =>
      result.data?.pages.reduce(
        (current, page) => appendUniqueProducts(current, page.items),
        [] as CatalogPresentationPage["items"],
      ) ?? [],
    [result.data],
  );

  if (result.isPending)
    return (
      <p role="status" className="py-16 text-center text-sm text-[var(--fm-text-muted)]">
        Loading groceries…
      </p>
    );
  if (result.isError && !result.data)
    return (
      <div role="alert" className="border-y border-[var(--fm-border)] py-12 text-center">
        <p className="text-sm text-[var(--fm-text-muted)]">Groceries could not be loaded.</p>
        <button
          type="button"
          onClick={() => void result.refetch()}
          className="mt-4 inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-5 text-sm font-semibold text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)]"
        >
          Try again
        </button>
      </div>
    );
  if (items.length === 0) return <ProductGridEmpty query={selection.query} />;

  return (
    <QuickViewProvider products={items}>
      <div>
        {result.isFetching && !result.isFetchingNextPage ? (
          <p role="status" className="mb-3 text-sm text-[var(--fm-text-muted)]">
            Refreshing groceries…
          </p>
        ) : null}
        {result.isError ? (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 text-sm text-[var(--fm-danger)]"
          >
            <span>Could not refresh groceries. Showing the previous results.</span>
            <button
              type="button"
              onClick={() => void result.refetch()}
              className="min-h-11 px-3 font-semibold underline"
            >
              Try again
            </button>
          </div>
        ) : null}
        <ProductGrid products={items} />
        <p role="status" aria-live="polite" className="sr-only">
          {items.length} products shown.
        </p>
        <p className="mt-6 text-center text-xs text-[var(--fm-text-muted)]" aria-hidden="true">
          Showing {items.length} {items.length === 1 ? "product" : "products"}
        </p>
        <div className="mt-4 flex justify-center">
          {result.isFetchNextPageError ? (
            <button
              type="button"
              onClick={() => void result.fetchNextPage()}
              className="inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-5 text-sm font-semibold text-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)]"
            >
              Try again
            </button>
          ) : result.hasNextPage ? (
            <button
              type="button"
              onClick={() => void result.fetchNextPage()}
              disabled={result.isFetchingNextPage}
              data-testid="load-more"
              className="inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-6 text-sm font-bold text-white disabled:opacity-60"
            >
              {result.isFetchingNextPage ? "Loading…" : "Load more groceries"}
            </button>
          ) : null}
        </div>
      </div>
    </QuickViewProvider>
  );
}
