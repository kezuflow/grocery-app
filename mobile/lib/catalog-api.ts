import type {
  MarketplaceHomeView,
  MarketplaceSearchView,
  RpcResult,
} from "@freshmarkets/contracts";

const apiOrigin = process.env.EXPO_PUBLIC_MOBILE_API_URL;

async function getCatalog<T>(path: string): Promise<T> {
  if (!apiOrigin) throw new Error("Set EXPO_PUBLIC_MOBILE_API_URL to connect to the catalog.");
  let response: Response;
  try {
    response = await fetch(new URL(path, apiOrigin).toString());
  } catch {
    throw new Error("Could not connect to the catalog. Check your network and API URL.");
  }
  const result = (await response.json()) as RpcResult<T>;
  if (!response.ok || !result.ok)
    throw new Error(!result.ok ? result.error.message : "Catalog is unavailable.");
  return result.value;
}

export const getHome = () => getCatalog<MarketplaceHomeView>("/v1/catalog/home");
export const searchCatalog = (query: string) =>
  getCatalog<MarketplaceSearchView>(`/v1/catalog/search?q=${encodeURIComponent(query)}`);
