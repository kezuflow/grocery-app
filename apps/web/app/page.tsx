import { MarketplaceCatalog } from "./marketplace-catalog";
import { StorefrontShell } from "../components/storefront/storefront-shell";

export default async function MarketplaceHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.category?.trim() || "all";
  return (
    <StorefrontShell>
      <div className="mx-auto max-w-[var(--fm-container-content)] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--fm-primary-dark)]">
              Fresh groceries for Cebu
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              Shop FreshMarkets
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--fm-text-muted)]">
              Browse fixed weights and packs. Delivery availability and final pricing are confirmed
              during checkout.
            </p>
          </div>
          <a
            href="/serviceability"
            className="text-sm font-semibold text-[var(--fm-primary-dark)] underline-offset-4 hover:underline"
          >
            Check delivery area
          </a>
        </div>
        <section aria-label="Grocery catalog" className="pt-6">
          <MarketplaceCatalog query={query} category={category} />
        </section>
      </div>
    </StorefrontShell>
  );
}
