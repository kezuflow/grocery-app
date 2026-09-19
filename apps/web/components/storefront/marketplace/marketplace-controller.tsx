"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { CategoryNavigationView } from "@freshmarkets/contracts";
import { useQueryEpoch } from "../../query-provider";
import {
  catalogHref,
  fetchCatalogHome,
  normalizeCatalogSelection,
  type CatalogHome,
  type CatalogPresentationPage,
  type CatalogSelection,
} from "../../../lib/query/catalog";
import { queryKeys } from "../../../lib/query/query-client";
import { ProductRail } from "../catalog-components";
import { PromoBanners } from "./promo-banners";
import { QuickViewProvider } from "./quick-view-provider";
import { CategoryStrip } from "./category-strip";
import { CatalogResults } from "./catalog-results";

export function MarketplaceController({
  initialSelection,
  initialPage,
  initialHome,
  categories,
}: {
  initialSelection: CatalogSelection;
  initialPage?: CatalogPresentationPage;
  initialHome?: CatalogHome;
  categories: CategoryNavigationView["categories"];
}) {
  const searchParams = useSearchParams();
  const selection = normalizeCatalogSelection(searchParams);
  const browsing = selection.query === "" && selection.category === "all";
  const epoch = useQueryEpoch();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);
  const home = useQuery({
    queryKey: [...queryKeys.catalog(epoch, "", "all"), "home"],
    queryFn: ({ signal }) => fetchCatalogHome(signal),
    initialData: epoch === 0 ? initialHome : undefined,
    enabled: browsing,
  });
  const isInitialResult =
    selection.query === initialSelection.query && selection.category === initialSelection.category;
  const resultInitialPage = !browsing && isInitialResult ? initialPage : undefined;
  const visibleCategories = home.data?.categories ?? categories;
  const activeCategory = visibleCategories.find((entry) => entry.slug === selection.category);
  const resultProducts = resultInitialPage?.items ?? [];
  const homeProducts = home.data?.rails.flatMap((rail) => rail.items) ?? [];
  const quickViewProducts = useMemo(
    () => (browsing ? homeProducts : resultProducts),
    [browsing, homeProducts, resultProducts],
  );

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [selection.category, selection.query]);

  const chooseCategory = (category: string) => {
    window.history.pushState(null, "", catalogHref({ query: "", category }));
  };
  const chooseRailCategory = (category: string) => (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor || anchor.getAttribute("href") !== `/?category=${category}`) return;
    event.preventDefault();
    chooseCategory(category);
  };

  return (
    <QuickViewProvider products={quickViewProducts}>
      <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <CategoryStrip
          categories={visibleCategories}
          activeCategory={selection.category}
          onCategorySelect={chooseCategory}
          className="-mx-4 px-4 sm:mx-0 sm:px-0"
        />
        <div id="catalog" className="mt-6 space-y-7">
          {browsing ? (
            home.isPending ? (
              <p role="status" className="py-16 text-center text-sm text-[var(--fm-text-muted)]">
                Loading groceries…
              </p>
            ) : home.isError && !home.data ? (
              <div role="alert" className="border-y border-[var(--fm-border)] py-12 text-center">
                <p className="text-sm text-[var(--fm-text-muted)]">
                  Groceries could not be loaded.
                </p>
                <button
                  type="button"
                  onClick={() => void home.refetch()}
                  className="mt-4 min-h-11 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-5 text-sm font-semibold"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                {home.isFetching ? (
                  <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                    Refreshing groceries…
                  </p>
                ) : null}
                {home.isError ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-3 text-sm text-[var(--fm-danger)]"
                  >
                    <span>Could not refresh groceries. Showing the previous home selection.</span>
                    <button
                      type="button"
                      onClick={() => void home.refetch()}
                      className="min-h-11 px-3 font-semibold underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
                {home.data.bannersAvailable ? (
                  <PromoBanners campaigns={[...home.data.banners]} />
                ) : (
                  <p role="status" className="text-sm text-[var(--fm-text-muted)]">
                    Offers are temporarily unavailable.
                  </p>
                )}
                {home.data.rails.map((rail, index) => (
                  <div key={rail.slug} onClickCapture={chooseRailCategory(rail.slug)}>
                    <ProductRail
                      title={rail.name}
                      priority={index === 0}
                      href={`/?category=${rail.slug}`}
                      products={rail.items}
                    />
                  </div>
                ))}
              </>
            )
          ) : (
            <>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                    {selection.query ? "Search results" : "Category"}
                  </p>
                  <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="mt-1 text-[2.25rem] leading-[2.625rem] font-semibold outline-none"
                  >
                    {selection.query
                      ? `Results for “${selection.query}”`
                      : (activeCategory?.name ?? "Browse groceries")}
                  </h2>
                </div>
              </div>
              <CatalogResults selection={selection} initialPage={resultInitialPage} />
            </>
          )}
        </div>
      </div>
    </QuickViewProvider>
  );
}
