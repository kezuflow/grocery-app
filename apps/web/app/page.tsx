import { env } from "cloudflare:workers";
import { coreClient } from "../lib/core-client/core";
import { StorefrontShell } from "../components/storefront/storefront-shell";
import { ProductGridEmpty, ProductRail } from "../components/storefront/catalog-components";
import { CatalogResults } from "../components/storefront/marketplace/catalog-results";
import { CategoryStrip } from "../components/storefront/marketplace/category-strip";
import { QuickViewProvider } from "../components/storefront/marketplace/quick-view-provider";
import { MembershipStrip, PromoBanners } from "../components/storefront/marketplace/promo-banners";
import { railEligible, toPresentationProducts } from "../lib/storefront/catalog-presentation";

const PAGE_SIZE = 24;

function CatalogError() {
  return (
    <div className="mx-auto max-w-[var(--fm-container-content)] px-4 py-16 sm:px-6 lg:px-8">
      <div role="alert" className="border-y border-[var(--fm-border)] py-16 text-center">
        <h1 className="text-xl font-bold">Groceries could not be loaded</h1>
        <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
          The catalog is temporarily unavailable. Please try again in a moment.
        </p>
      </div>
    </div>
  );
}

/**
 * Server-rendered marketplace home. Browsing uses Core's bounded
 * marketplace.getHome read model (category rails); search/category URLs go
 * through paginated catalog search so nothing is client-filtered from a
 * truncated list. Subsequent result pages load progressively through the
 * CatalogResults boundary.
 */
export default async function MarketplaceHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.category?.trim() || "all";
  const browsing = category === "all" && query === "";
  const requestId = crypto.randomUUID();
  const client = coreClient(env.CORE);

  if (browsing) {
    const home = await client.getMarketplaceHome({ requestId, itemsPerRail: 8 });
    if (!home.ok) {
      return (
        <StorefrontShell>
          <CatalogError />
        </StorefrontShell>
      );
    }
    const rails = home.value.rails.map((rail) => ({
      slug: rail.categorySlug,
      name: rail.title,
      products: railEligible(toPresentationProducts(rail.items)),
    }));
    const providerProducts = rails.flatMap((rail) => rail.products);

    return (
      <StorefrontShell>
        <QuickViewProvider products={providerProducts}>
          <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <CategoryStrip
              categories={home.value.categories}
              activeCategory={category}
              className="-mx-4 px-4 sm:mx-0 sm:px-0"
            />

            <div className="mt-6 space-y-7">
              <PromoBanners />
              {rails.map((rail) => (
                <ProductRail
                  key={rail.slug}
                  title={rail.name}
                  href={`/?category=${rail.slug}`}
                  products={rail.products}
                />
              ))}
              <MembershipStrip />
            </div>
          </div>
        </QuickViewProvider>
      </StorefrontShell>
    );
  }

  const [results, categories] = await Promise.all([
    client.searchCatalog({
      requestId,
      query: query || undefined,
      categorySlug: category === "all" ? undefined : category,
      limit: PAGE_SIZE,
    }),
    client.listCategories({ requestId: crypto.randomUUID() }),
  ]);

  if (!results.ok) {
    return (
      <StorefrontShell>
        <CatalogError />
      </StorefrontShell>
    );
  }

  const firstPage = toPresentationProducts(results.value.items);
  const categoryLinks = categories.ok ? categories.value.categories : [];
  const activeCategory = categoryLinks.find((entry) => entry.slug === category);

  return (
    <StorefrontShell>
      <QuickViewProvider products={firstPage}>
        <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <CategoryStrip
            categories={categoryLinks}
            activeCategory={category}
            className="-mx-4 px-4 sm:mx-0 sm:px-0"
          />

          <div className="mt-6 space-y-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
                  {query ? "Search results" : "Category"}
                </p>
                <h2 className="mt-1 text-[32px] leading-[42px] font-semibold">
                  {query ? `Results for “${query}”` : (activeCategory?.name ?? "Browse groceries")}
                </h2>
              </div>
            </div>
            {firstPage.length > 0 ? (
              <CatalogResults
                initialItems={firstPage}
                initialCursor={results.value.nextCursor}
                query={query}
                categorySlug={category === "all" ? undefined : category}
              />
            ) : (
              <ProductGridEmpty query={query} />
            )}
            <MembershipStrip />
          </div>
        </div>
      </QuickViewProvider>
    </StorefrontShell>
  );
}
