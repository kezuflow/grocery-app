import type { RequestMeta, RpcResult } from "./common";
import type { ServiceabilityRequest, ServiceabilityResult } from "./geography";
import type { DeliveryCycleState } from "./states";
import type { PublishedBanner } from "./banner-media";

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
  /** Current public, unconditional price for one unit; checkout confirms quantities and eligibility. */
  sale?: {
    promotionId: string;
    name: string;
    priceMinor: number;
    remainingQuantity: number | null;
    endsAt: string | null;
  };
  currency: string | null;
  priceVersion: number | null;
  availability: "AVAILABLE" | "OUT_OF_STOCK" | "PRICE_UNAVAILABLE" | "LOCATION_REQUIRED";
};

export type CatalogMedia = { src: string; alt: string };
export type PublishedProductMediaRequest = RequestMeta & { mediaId: string; version: number };
export type PublishedProductMediaContent = {
  bytes: ArrayBuffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  etag: string;
};
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

export type StorefrontHomeView = {
  marketplace: MarketplaceHomeView;
  banners: ReadonlyArray<PublishedBanner>;
  bannersAvailable: boolean;
  announcementSchedule: StorefrontAnnouncementSchedule;
};

export type StorefrontAnnouncementSchedule = "GENERAL" | "MONDAY_FRIDAY_SUNDAY";

export type MarketplaceSearchView = {
  page: CatalogSearchPage;
  categories: CategoryNavigationView["categories"];
  categoriesAvailable: boolean;
};

export type MarketplaceHomeRequest = RequestMeta & {
  locationId?: string;
  browsingContextToken?: string;
  itemsPerRail?: number;
};

export type MarketplaceProductView = {
  product: CatalogProduct;
  images: ReadonlyArray<CatalogMedia>;
  deliveryContext: { locationAware: boolean };
};

export type CatalogSearchRequest = RequestMeta & {
  query?: string;
  categorySlug?: string;
  cursor?: string;
  limit?: number;
  locationId?: string;
  browsingContextToken?: string;
};

export type CatalogProductRequest = RequestMeta & {
  slug: string;
  locationId?: string;
  browsingContextToken?: string;
};
export type DeliveryCycleRequest = RequestMeta & { marketCode?: string };
export type DeliveryCycleView = {
  id: string;
  name: string;
  cutoffAt: string;
  deliveryDate: string;
  status: DeliveryCycleState;
};

export type CatalogService = {
  getPublishedProductMedia(
    request: PublishedProductMediaRequest,
  ): Promise<RpcResult<PublishedProductMediaContent>>;
  resolveServiceability(request: ServiceabilityRequest): Promise<RpcResult<ServiceabilityResult>>;
  searchCatalog(request: CatalogSearchRequest): Promise<RpcResult<CatalogSearchPage>>;
  /** Bounded home discovery; rails never materialize the whole catalog. */
  getMarketplaceHome(request: MarketplaceHomeRequest): Promise<RpcResult<MarketplaceHomeView>>;
  getStorefrontHome(request: MarketplaceHomeRequest): Promise<RpcResult<StorefrontHomeView>>;
  searchMarketplace(request: CatalogSearchRequest): Promise<RpcResult<MarketplaceSearchView>>;
  getCatalogProduct(
    request: CatalogProductRequest,
  ): Promise<RpcResult<MarketplaceProductView | null>>;
  listCategories(request: RequestMeta): Promise<RpcResult<CategoryNavigationView>>;
  listDeliveryCycles(
    request: DeliveryCycleRequest,
  ): Promise<RpcResult<ReadonlyArray<DeliveryCycleView>>>;
};
