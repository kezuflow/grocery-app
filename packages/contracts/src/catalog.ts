import type { RequestMeta, RpcResult } from "./common";
import type {
  CatalogProductRequest,
  CatalogSearchPage,
  CatalogSearchRequest,
  CategoryNavigationView,
  DeliveryCycleRequest,
  DeliveryCycleView,
  MarketplaceHomeRequest,
  MarketplaceHomeView,
  MarketplaceProductView,
  ServiceabilityRequest,
  ServiceabilityResult,
} from "./index";

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
