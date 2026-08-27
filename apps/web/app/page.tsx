import Link from "next/link";
import { env } from "cloudflare:workers";
import { coreClient } from "../lib/core-client/core";
import { StorefrontShell } from "../components/storefront/storefront-shell";
import {
  ProductGrid,
  ProductGridEmpty,
  ProductRail,
} from "../components/storefront/catalog-components";
import { QuickViewProvider } from "../components/storefront/marketplace/quick-view-provider";
import { MarketplaceHero } from "../components/storefront/marketplace/marketplace-hero";
import { MembershipStrip, PromoBanners } from "../components/storefront/marketplace/promo-banners";
import { railEligible, toPresentationProducts } from "../lib/storefront/catalog-presentation";
import { cn } from "../lib/utils";

type CategoryLink = { slug: string; name: string };

/**
 * Server-rendered marketplace home. Catalog and category reads go straight to
 * Core through the service binding; interactivity (quick view, add-to-cart)
 * hydrates on the client without refetching what the server already rendered.
 */
export default async function MarketplaceHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.category?.trim() || "all";
  const client = coreClient(env.CORE);
  const [catalog, categories] = await Promise.all([
    client.searchCatalog({
      requestId: crypto.randomUUID(),
      query: query || undefined,
      limit: 50,
    }),
    client.listCategories({ requestId: crypto.randomUUID() }),
  ]);

  if (!catalog.ok) {
    return (
      <StorefrontShell>
        <div className="mx-auto max-w-[var(--fm-container-content)] px-4 py-16 sm:px-6 lg:px-8">
          <div role="alert" className="border-y border-[var(--fm-border)] py-16 text-center">
            <h1 className="text-xl font-bold">Groceries could not be loaded</h1>
            <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
              The catalog is temporarily unavailable. Please try again in a moment.
            </p>
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const products = toPresentationProducts(catalog.value.items);
  const categoryLinks: ReadonlyArray<CategoryLink> = categories.ok
    ? categories.value.categories
    : [];
  const activeCategory = categoryLinks.find((entry) => entry.slug === category);
  const browsing = category === "all" && query === "";
  const eligible = railEligible(products);
  const filtered =
    category === "all" ? products : products.filter((item) => item.categorySlug === category);

  const railCategories = categoryLinks
    .filter((entry) => entry.slug !== "fresh-produce")
    .map((entry) => ({
      ...entry,
      items: eligible.filter((item) => item.categorySlug === entry.slug).slice(0, 8),
    }))
    .filter((entry) => entry.items.length > 0);

  return (
    <StorefrontShell>
      <QuickViewProvider products={products}>
        <div className="mx-auto max-w-[var(--fm-container-content)] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <MarketplaceHero />

          <nav
            aria-label="Grocery categories"
            className="fm-scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
          >
            <Link
              href="/"
              aria-current={browsing ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-[var(--fm-radius-control)] px-3 py-2 text-sm font-medium text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
                browsing && "bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)]",
              )}
            >
              All groceries
            </Link>
            {categoryLinks.map((entry) => (
              <Link
                key={entry.slug}
                href={`/?category=${entry.slug}`}
                aria-current={category === entry.slug ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-[var(--fm-radius-control)] px-3 py-2 text-sm font-medium text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
                  category === entry.slug &&
                    "bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)]",
                )}
              >
                {entry.name}
              </Link>
            ))}
          </nav>

          <div className="mt-6 space-y-8">
            {browsing ? (
              <>
                <PromoBanners />
                <ProductRail
                  title="Fresh this week"
                  subtitle="Everyday produce picks, packed fresh."
                  products={eligible.slice(0, 8)}
                />
                {railCategories.map((entry) => (
                  <ProductRail
                    key={entry.slug}
                    title={entry.name}
                    href={`/?category=${entry.slug}`}
                    products={entry.items}
                  />
                ))}
                <MembershipStrip />
              </>
            ) : (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                      {query ? "Search results" : "Category"}
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-[-0.02em]">
                      {query
                        ? `Results for “${query}”`
                        : (activeCategory?.name ?? "Browse groceries")}
                    </h2>
                  </div>
                  <p className="shrink-0 pb-1 text-xs text-[var(--fm-text-muted)]">
                    {filtered.length} {filtered.length === 1 ? "product" : "products"}
                  </p>
                </div>
                {filtered.length > 0 ? (
                  <ProductGrid products={filtered} />
                ) : (
                  <ProductGridEmpty query={query} />
                )}
                <MembershipStrip />
              </>
            )}
          </div>
        </div>
      </QuickViewProvider>
    </StorefrontShell>
  );
}
