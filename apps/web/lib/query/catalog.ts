import type {
  CatalogSearchPage,
  CategoryNavigationView,
  PublishedBanner,
  StorefrontHomeView,
} from "@freshmarkets/contracts";
import { readJson } from "../http/read-deadline";
import {
  railEligible,
  toPresentationProducts,
  type PresentationProduct,
} from "../storefront/catalog-presentation";

export type CatalogPresentationPage = {
  items: ReadonlyArray<PresentationProduct>;
  nextCursor: string | null;
};

export type CatalogSelection = { query: string; category: string };
export type CatalogHome = {
  categories: CategoryNavigationView["categories"];
  rails: ReadonlyArray<{
    slug: string;
    name: string;
    items: ReadonlyArray<PresentationProduct>;
  }>;
  banners: ReadonlyArray<PublishedBanner>;
  bannersAvailable: boolean;
};

export function normalizeCatalogSelection(
  searchParams: Pick<URLSearchParams, "get">,
): CatalogSelection {
  return {
    query: searchParams.get("q")?.trim() ?? "",
    category: searchParams.get("category")?.trim() || "all",
  };
}

export function catalogHref({ query, category }: CatalogSelection): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category !== "all") params.set("category", category);
  const serialized = params.toString();
  return serialized ? `/?${serialized}` : "/";
}

export async function fetchCatalogPage({
  query,
  category,
  cursor,
  signal,
}: CatalogSelection & {
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<CatalogPresentationPage> {
  const params = new URLSearchParams({ limit: "24" });
  if (query) params.set("q", query);
  if (category !== "all") params.set("category", category);
  if (cursor) params.set("cursor", cursor);
  const payload = await readJson<{ ok: true; value: CatalogSearchPage } | { ok: false }>(
    `/api/catalog?${params.toString()}`,
    { signal },
  );
  if (!payload.ok) throw new Error("catalog request failed");
  return {
    items: toPresentationProducts(payload.value.items),
    nextCursor: payload.value.nextCursor,
  };
}

export function normalizeCatalogHome(value: StorefrontHomeView): CatalogHome {
  return {
    categories: value.marketplace.categories,
    rails: value.marketplace.rails.map((rail) => ({
      slug: rail.categorySlug,
      name: rail.title,
      items: railEligible(toPresentationProducts(rail.items)),
    })),
    banners: value.banners,
    bannersAvailable: value.bannersAvailable,
  };
}

export async function fetchCatalogHome(signal?: AbortSignal): Promise<CatalogHome> {
  const payload = await readJson<{ ok: true; value: StorefrontHomeView } | { ok: false }>(
    "/api/catalog?home=1",
    { signal },
  );
  if (!payload.ok) throw new Error("catalog home request failed");
  return normalizeCatalogHome(payload.value);
}
