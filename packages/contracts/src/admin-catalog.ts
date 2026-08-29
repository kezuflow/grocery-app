import type { AdminAuditEventListItem, AuthenticatedRequest, RpcResult } from "./index";

export const catalogStatuses = ["active", "inactive"] as const;
export type CatalogStatus = (typeof catalogStatuses)[number];

export const sourcingModes = ["STOCKED", "PLANNED", "ON_DEMAND", "MIXED"] as const;
export type SourcingMode = (typeof sourcingModes)[number];

export const canonicalBaseUnitCodes = ["GRAM", "MILLILITER", "PIECE"] as const;
export type CanonicalBaseUnitCode = (typeof canonicalBaseUnitCodes)[number];

export type AdminCategorySummary = {
  categoryId: string;
  code: string;
  name: string;
  slug: string;
  status: CatalogStatus;
  sortOrder: number;
  iconAssetKey: string | null;
  parentCategoryId: string | null;
  parentName: string | null;
  productCount: number;
  version: number;
};

export type AdminCategoryProductSummary = Pick<
  AdminProductSummary,
  "productId" | "slug" | "name" | "status" | "skuCount" | "version"
>;

export type AdminCategoryDetail = Omit<
  AdminCategorySummary,
  "parentCategoryId" | "parentName" | "productCount"
> & {
  parent: Pick<AdminCategorySummary, "categoryId" | "code" | "name"> | null;
  children: ReadonlyArray<AdminCategorySummary>;
  products: ReadonlyArray<AdminCategoryProductSummary>;
  allowedActions: ReadonlyArray<"UPDATE" | "SET_STATUS">;
  recentAudit: ReadonlyArray<AdminAuditEventListItem>;
};

export type AdminCategoryPage = {
  items: ReadonlyArray<AdminCategorySummary>;
  nextCursor: string | null;
};

export type AdminUnitSummary = {
  unitId: string;
  code: string;
  displayName: string;
  dimension: "MASS" | "COUNT" | "VOLUME";
  canonicalBaseCode: CanonicalBaseUnitCode;
  conversionNumerator: number;
  conversionDenominator: number;
  status: CatalogStatus;
  version: number;
};

export type AdminProductSummary = {
  productId: string;
  slug: string;
  name: string;
  categoryCode: string;
  status: CatalogStatus;
  skuCount: number;
  version: number;
};

export type AdminProductPage = {
  items: ReadonlyArray<AdminProductSummary>;
  nextCursor: string | null;
};

export type AdminCatalogSkuSummary = {
  skuId: string;
  code: string;
  name: string;
  merchandisingLabel: string | null;
  unitSymbol: string;
  sellQuantity: number;
  consumptionBaseQuantity: number;
  status: CatalogStatus;
  sortOrder: number;
  version: number;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | null;
  availabilityVersion: number | null;
  sourcingMode: SourcingMode | null;
};

export type AdminProductDetail = {
  productId: string;
  slug: string;
  name: string;
  description: string | null;
  categoryCode: string;
  categoryName: string;
  status: CatalogStatus;
  version: number;
  skus: ReadonlyArray<AdminCatalogSkuSummary>;
};

export type AdminInventoryItem = {
  locationId: string;
  inventoryPoolId: string;
  productId: string;
  productName: string;
  baseUnitSymbol: string;
  onHandBase: number;
  reservedBase: number;
  version: number;
};

export type AdminInventoryPage = {
  items: ReadonlyArray<AdminInventoryItem>;
  nextCursor: string | null;
};

export type AdminInventoryLedgerEntry = {
  entryId: string;
  movementType: string;
  quantityDeltaBase: number;
  reservationDeltaBase: number;
  reasonCode: string | null;
  actorId: string | null;
  createdAt: string;
};

export type AdminInventoryLedgerPage = {
  items: ReadonlyArray<AdminInventoryLedgerEntry>;
  nextCursor: string | null;
};

export type AdminCategoryListRequest = AuthenticatedRequest;
export type AdminCategoryCreateRequest = AuthenticatedRequest & {
  code: string;
  name: string;
  slug: string;
  sortOrder?: number;
  parentCategoryId?: string | null;
  iconAssetKey?: string | null;
  idempotencyKey: string;
};

export type AdminCategoryDetailRequest = AuthenticatedRequest & { categoryId: string };
export type AdminCategoryUpdateRequest = AuthenticatedRequest & {
  categoryId: string;
  name: string;
  slug: string;
  parentCategoryId: string | null;
  iconAssetKey: string | null;
  sortOrder: number;
  expectedVersion: number;
  idempotencyKey: string;
};
export type AdminCategoryStatusRequest = AuthenticatedRequest & {
  categoryId: string;
  status: CatalogStatus;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminUnitListRequest = AuthenticatedRequest;
export type AdminUnitCreateRequest = AuthenticatedRequest & {
  code: string;
  displayName: string;
  dimension: "MASS" | "COUNT" | "VOLUME";
  canonicalBaseCode: CanonicalBaseUnitCode;
  conversionNumerator: number;
  conversionDenominator: number;
  idempotencyKey: string;
};

export type AdminProductListRequest = AuthenticatedRequest & {
  query?: string;
  cursor?: string;
  limit?: number;
};

export type AdminProductDetailRequest = AuthenticatedRequest & {
  productId: string;
};

export type AdminProductStatusRequest = AuthenticatedRequest & {
  productId: string;
  status: CatalogStatus;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminSkuCreateRequest = AuthenticatedRequest & {
  productId: string;
  code: string;
  name: string;
  sellableUnitId: string;
  sellQuantity: number;
  consumptionBaseQuantity: number;
  merchandisingLabel?: string | null;
  sortOrder?: number;
  idempotencyKey: string;
};

export type AdminSkuUpdateRequest = AuthenticatedRequest & {
  skuId: string;
  name?: string;
  merchandisingLabel?: string | null;
  status?: CatalogStatus;
  sortOrder?: number;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminSkuAvailabilityRequest = AuthenticatedRequest & {
  skuId: string;
  locationId: string;
  availabilityStatus: "AVAILABLE" | "UNAVAILABLE";
  sourcingMode: SourcingMode;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminSkuPriceRequest = AuthenticatedRequest & {
  skuId: string;
  marketId: string;
  locationId: string | null;
  currency: string;
  amountMinor: number;
  validFrom: number;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminInventoryListRequest = AuthenticatedRequest & {
  locationId: string;
  cursor?: string;
  limit?: number;
};

export type AdminInventoryLedgerRequest = AuthenticatedRequest & {
  locationId: string;
  inventoryPoolId: string;
  cursor?: string;
  limit?: number;
};

/**
 * Catalog administration. Reads require `catalog.read` and commands
 * `catalog.manage`, both plus a global scope in Core. Prices are versioned
 * inserts; history is never rewritten.
 */
export type AdminCatalogService = {
  listAdminCategories(request: AdminCategoryListRequest): Promise<RpcResult<AdminCategoryPage>>;
  createAdminCategory(
    request: AdminCategoryCreateRequest,
  ): Promise<RpcResult<AdminCategorySummary>>;
  getAdminCategory(request: AdminCategoryDetailRequest): Promise<RpcResult<AdminCategoryDetail>>;
  updateAdminCategory(
    request: AdminCategoryUpdateRequest,
  ): Promise<RpcResult<AdminCategorySummary>>;
  setAdminCategoryStatus(
    request: AdminCategoryStatusRequest,
  ): Promise<RpcResult<AdminCategorySummary>>;
  listAdminUnits(request: AdminUnitListRequest): Promise<RpcResult<AdminUnitSummary[]>>;
  createAdminUnit(request: AdminUnitCreateRequest): Promise<RpcResult<AdminUnitSummary>>;
  listAdminProducts(request: AdminProductListRequest): Promise<RpcResult<AdminProductPage>>;
  getAdminProduct(request: AdminProductDetailRequest): Promise<RpcResult<AdminProductDetail>>;
  setAdminProductStatus(
    request: AdminProductStatusRequest,
  ): Promise<RpcResult<AdminProductSummary>>;
  createAdminSku(request: AdminSkuCreateRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
  updateAdminSku(request: AdminSkuUpdateRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
  setAdminSkuAvailability(
    request: AdminSkuAvailabilityRequest,
  ): Promise<RpcResult<AdminCatalogSkuSummary>>;
  setAdminSkuPrice(request: AdminSkuPriceRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
};

/**
 * Inventory read side. Every request is operational-location scoped in Core;
 * the guarded adjustment command already exists (`inventory.adjust`).
 */
export type AdminInventoryReadService = {
  listAdminInventory(request: AdminInventoryListRequest): Promise<RpcResult<AdminInventoryPage>>;
  getAdminInventoryLedger(
    request: AdminInventoryLedgerRequest,
  ): Promise<RpcResult<AdminInventoryLedgerPage>>;
};
