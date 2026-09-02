import type { RequestMeta, RpcResult } from "./common";
import type { ServiceabilityRequest, ServiceabilityResult } from "./geography";
import type { DeliveryCycleState } from "./states";

export type CatalogSellUnitCode = "G" | "KG" | "PC";

export type CatalogVariant = {
  id: string;
  code: string;
  name: string;
  merchandisingLabel: string | null;
  sellQuantity: number;
  sellUnitCode: CatalogSellUnitCode;
  unit: string;
  consumptionBaseQuantity: number;
  contentsNote: string | null;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
  availability: "AVAILABLE" | "OUT_OF_STOCK" | "PRICE_UNAVAILABLE" | "LOCATION_REQUIRED";
};

export type CatalogMedia = { src: string; alt: string };
export type CatalogDetail = { label: string; value: string; sortOrder: number };

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: { code: string; name: string; slug: string };
  media: CatalogMedia | null;
  details: ReadonlyArray<CatalogDetail>;
  available: boolean;
  variants: ReadonlyArray<CatalogVariant>;
};

export type CatalogSearchPage = {
  items: ReadonlyArray<CatalogProduct>;
  nextCursor: string | null;
};

export type CategoryNavigationView = {
  categories: ReadonlyArray<{
    code: string;
    name: string;
    slug: string;
    iconSrc: string | null;
  }>;
};

export type MarketplaceHomeRail = {
  code: string;
  title: string;
  categorySlug: string;
  items: ReadonlyArray<CatalogProduct>;
};

export type MarketplaceHomeView = {
  categories: CategoryNavigationView["categories"];
  rails: ReadonlyArray<MarketplaceHomeRail>;
};

export type MarketplaceHomeRequest = RequestMeta & {
  locationId?: string;
  itemsPerRail?: number;
};

export type MarketplaceProductView = {
  product: CatalogProduct;
  deliveryContext: { locationAware: boolean };
};

export type CatalogSearchRequest = RequestMeta & {
  query?: string;
  categorySlug?: string;
  cursor?: string;
  limit?: number;
  locationId?: string;
};

export type CatalogProductRequest = RequestMeta & { slug: string; locationId?: string };
export type DeliveryCycleRequest = RequestMeta & { marketCode?: string };
export type DeliveryCycleView = {
  id: string;
  name: string;
  cutoffAt: string;
  deliveryDate: string;
  status: DeliveryCycleState;
  capacityRemaining: number;
};

export type CatalogService = {
  resolveServiceability(request: ServiceabilityRequest): Promise<RpcResult<ServiceabilityResult>>;
  searchCatalog(request: CatalogSearchRequest): Promise<RpcResult<CatalogSearchPage>>;
  /** Bounded home discovery; rails never materialize the whole catalog. */
  getMarketplaceHome(request: MarketplaceHomeRequest): Promise<RpcResult<MarketplaceHomeView>>;
  getCatalogProduct(
    request: CatalogProductRequest,
  ): Promise<RpcResult<MarketplaceProductView | null>>;
  listCategories(request: RequestMeta): Promise<RpcResult<CategoryNavigationView>>;
  listDeliveryCycles(
    request: DeliveryCycleRequest,
  ): Promise<RpcResult<ReadonlyArray<DeliveryCycleView>>>;
};
