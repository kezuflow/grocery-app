import { env } from "cloudflare:workers";
import { Suspense } from "react";
import { MarketplaceController } from "../../components/storefront/marketplace/marketplace-controller";
import { AnnouncementPopup } from "../../components/storefront/announcement/announcement-popup";
import { RetryReadButton } from "../../components/storefront/retry-read-button";
import { coreClient } from "../../lib/core-client/core";
import { withReadDeadline } from "../../lib/http/read-deadline";
import { normalizeCatalogHome, type CatalogSelection } from "../../lib/query/catalog";
import { toPresentationProducts } from "../../lib/storefront/catalog-presentation";
import { readBrowsingLocation } from "../../lib/storefront/read-browsing-location";

const PAGE_SIZE = 24;

function CatalogError() {
  return (
    <div className="mx-auto max-w-[var(--fm-container-content)] px-4 py-16 sm:px-6 lg:px-8">
      <div role="alert" className="border-y border-[var(--fm-border)] py-16 text-center">
        <h1 className="text-xl font-bold">Groceries could not be loaded</h1>
        <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
          The catalog is temporarily unavailable. Please try again in a moment.
        </p>
        <RetryReadButton />
      </div>
    </div>
  );
}

async function MarketplaceContents({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const selection: CatalogSelection = {
    query: params.q?.trim() ?? "",
    category: params.category?.trim() || "all",
  };
  const browsing = selection.category === "all" && selection.query === "";
  const requestId = crypto.randomUUID();
  const client = coreClient(env.CORE);
  const catalogLocation = await readBrowsingLocation();

  if (browsing) {
    const home = await client.getStorefrontHome({
      requestId,
      itemsPerRail: 12,
      ...catalogLocation,
    });
    if (!home.ok) return <CatalogError />;
    return (
      <>
        <AnnouncementPopup />
        <MarketplaceController
          initialSelection={selection}
          initialHome={normalizeCatalogHome(home.value)}
          categories={home.value.marketplace.categories}
        />
      </>
    );
  }

  const results = await client.searchMarketplace({
    requestId,
    query: selection.query || undefined,
    categorySlug: selection.category === "all" ? undefined : selection.category,
    limit: PAGE_SIZE,
    ...catalogLocation,
  });
  if (!results.ok) return <CatalogError />;

  return (
    <MarketplaceController
      initialSelection={selection}
      initialPage={{
        items: toPresentationProducts(results.value.page.items),
        nextCursor: results.value.page.nextCursor,
      }}
      categories={results.value.categoriesAvailable ? results.value.categories : []}
    />
  );
}

type HomeProps = { searchParams: Promise<{ q?: string; category?: string }> };
async function CatalogContent(props: HomeProps) {
  try {
    return await withReadDeadline(MarketplaceContents(props));
  } catch {
    return <CatalogError />;
  }
}

export default function MarketplaceHome(props: HomeProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          Loading groceries…
        </p>
      }
    >
      <CatalogContent {...props} />
    </Suspense>
  );
}
