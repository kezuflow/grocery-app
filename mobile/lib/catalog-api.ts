import type {
  AddressSearchCandidate,
  ConfirmedBrowsingLocation,
  Coordinate,
  MarketplaceHomeView,
  MarketplaceProductView,
  MarketplaceSearchView,
  RpcResult,
} from "@freshmarkets/contracts";
import { readLocation } from "./location-store";

const apiOrigin = process.env.EXPO_PUBLIC_MOBILE_API_URL;

async function callApi<T>(
  path: string,
  init: RequestInit = {},
  includeLocation = true,
): Promise<T> {
  if (!apiOrigin) throw new Error("Set EXPO_PUBLIC_MOBILE_API_URL to connect to the catalog.");
  let response: Response;
  try {
    const token = includeLocation ? (await readLocation())?.browsingContextToken : null;
    response = await fetch(new URL(path, apiOrigin).toString(), {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { "x-browsing-context": token } : {}),
      },
    });
  } catch {
    throw new Error("Could not connect to the catalog. Check your network and API URL.");
  }
  const result = (await response.json()) as RpcResult<T>;
  if (!response.ok || !result.ok)
    throw new Error(
      !result.ok
        ? result.error.message || "The request could not be completed."
        : "The request could not be completed.",
    );
  return result.value;
}

const getCatalog = <T>(path: string) => callApi<T>(path);

export const getHome = () => getCatalog<MarketplaceHomeView>("/v1/catalog/home");
export const searchCatalog = (query: string, categorySlug?: string, cursor?: string) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (categorySlug) params.set("category", categorySlug);
  if (cursor) params.set("cursor", cursor);
  return getCatalog<MarketplaceSearchView>(`/v1/catalog/search?${params.toString()}`);
};
export const getProduct = (slug: string) =>
  getCatalog<MarketplaceProductView | null>(`/v1/catalog/product?slug=${encodeURIComponent(slug)}`);
export const searchAddresses = (query: string) =>
  callApi<ReadonlyArray<AddressSearchCandidate>>(
    "/v1/location/search",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    },
    false,
  );
export const confirmLocation = (coordinate: Coordinate) =>
  callApi<ConfirmedBrowsingLocation>(
    "/v1/location/confirm",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate }),
    },
    false,
  );
