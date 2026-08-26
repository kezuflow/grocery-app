import type { RequestMeta, RpcResult } from "./common";
import type {
  CatalogProductRequest,
  CatalogSearchPage,
  CatalogSearchRequest,
  CategoryNavigationView,
  DeliveryCycleRequest,
  DeliveryCycleView,
  MarketplaceProductView,
  ServiceabilityRequest,
  ServiceabilityResult,
} from "./index";

export type CatalogService = {
  resolveServiceability(request: ServiceabilityRequest): Promise<RpcResult<ServiceabilityResult>>;
  searchCatalog(request: CatalogSearchRequest): Promise<RpcResult<CatalogSearchPage>>;
  getCatalogProduct(
    request: CatalogProductRequest,
  ): Promise<RpcResult<MarketplaceProductView | null>>;
  listCategories(request: RequestMeta): Promise<RpcResult<CategoryNavigationView>>;
  listDeliveryCycles(
    request: DeliveryCycleRequest,
  ): Promise<RpcResult<ReadonlyArray<DeliveryCycleView>>>;
};
