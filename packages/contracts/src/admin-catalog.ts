import type { AuthenticatedRequest } from "./auth";
import type { AdminAuditEventListItem } from "./admin-foundation";
import type { RpcResult } from "./common";

export const catalogStatuses = ["active", "inactive"] as const;
export type CatalogStatus = (typeof catalogStatuses)[number];

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

export type AdminProductListSummary = AdminProductSummary & {
  activeSkuCount: number;
  pricedSkuCount: number;
  availableSkuCount: number;
  primaryMedia: {
    mediaId: string;
    altText: string;
    version: number;
  } | null;
  priceRange: {
    minimumMinor: number;
    maximumMinor: number;
    currency: string;
  } | null;
  inventoryPosition: AdminProductInventoryPosition | null;
};

export type AdminProductScope =
  | { kind: "GLOBAL" }
  | {
      kind: "LOCATION";
      marketId: string;
      marketName: string;
      locationId: string;
      locationName: string;
      currency: string;
    };

export type AdminProductPage = {
  items: ReadonlyArray<AdminProductListSummary>;
  readiness: {
    activeProducts: number;
    inactiveProducts: number;
    missingPrimaryMedia: number;
    missingPrices: number;
    unavailableSkus: number;
  };
  scope: AdminProductScope;
  nextCursor: string | null;
};

export type AdminCatalogSkuSummary = {
  stockPoolId?: string | null;
  availableBase?: number | null;
  skuId: string;
  code: string;
  name: string;
  merchandisingLabel: string | null;
  unitSymbol: string;
  sellQuantity: number;
  consumptionBaseQuantity: number;
  estimatedShippingWeightGrams: number | null;
  status: CatalogStatus;
  sortOrder: number;
  version: number;
  priceMinor: number | null;
  currency: string | null;
  priceVersion: number | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | null;
  availabilityVersion: number | null;
};

export type AdminProductDetail = {
  productId: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  categoryCode: string;
  categoryName: string;
  status: CatalogStatus;
  version: number;
  customerDetails: ReadonlyArray<AdminProductCustomerDetail>;
  media: ReadonlyArray<AdminProductMediaView>;
  inventoryPool: AdminProductInventoryPoolView;
  scope: AdminProductScope;
  allowedActions: ReadonlyArray<"UPDATE" | "SET_STATUS">;
  recentAudit: ReadonlyArray<AdminAuditEventListItem>;
  skus: ReadonlyArray<AdminCatalogSkuSummary>;
};

export type AdminProductCustomerDetail = {
  detailId: string;
  label: string;
  value: string;
  sortOrder: number;
};

export type AdminProductMediaView = {
  mediaId: string;
  mimeType: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  status: CatalogStatus;
  version: number;
};

export const adminProductMediaMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type AdminProductMediaMimeType = (typeof adminProductMediaMimeTypes)[number];
export const adminProductMediaMaxBytes = 5 * 1024 * 1024;
export const adminProductMediaMaxCount = 5;

export type AdminProductInventoryPoolView = {
  stockTracking?: "SHARED" | "COUNTED_SIZES";
  inventoryPoolId: string;
  baseUnitId: string;
  baseUnitCode: CanonicalBaseUnitCode;
  baseUnitSymbol: string;
  position: AdminProductInventoryPosition | null;
};

export type AdminProductInventoryPosition = {
  locationId: string;
  onHandBase: number;
  reservedBase: number;
  availableBase: number;
  version: number;
};

export type AdminInventoryItem = {
  stockKind?: "SHARED" | "BULK" | "COUNTED_SIZE";
  skuId?: string | null;
  locationId: string;
  inventoryPoolId: string;
  productId: string;
  productName: string;
  baseUnitSymbol: string;
  onHandBase: number;
  reservedBase: number;
  heldBase?: number;
  availableBase?: number;
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

export type AdminCategoryListRequest = AuthenticatedRequest & {
  query?: string;
  status?: CatalogStatus;
  cursor?: string;
  limit?: number;
};
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

export type AdminProductScopeRequest =
  | { scopeKind: "GLOBAL" }
  | { scopeKind: "LOCATION"; marketId: string; locationId: string };

export type AdminProductListRequest = AuthenticatedRequest &
  AdminProductScopeRequest & {
    query?: string;
    status?: CatalogStatus;
    cursor?: string;
    limit?: number;
  };

export type AdminProductMediaContentRequest = AuthenticatedRequest & {
  productId: string;
  mediaId: string;
  locationId?: string;
};

export type AdminProductMediaContent = {
  bytes: ArrayBuffer;
  mimeType: string;
  etag: string;
  version: number;
};

export type AdminProductCustomerDetailInput = {
  label: string;
  value: string;
  sortOrder: number;
};

export type AdminProductCreateRequest = AuthenticatedRequest & {
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  customerDetails: ReadonlyArray<AdminProductCustomerDetailInput>;
  inventoryBaseUnitId: string;
  stockTracking?: "SHARED" | "COUNTED_SIZES";
  idempotencyKey: string;
};

export type AdminProductUpdateRequest = AuthenticatedRequest & {
  productId: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  customerDetails: ReadonlyArray<AdminProductCustomerDetailInput>;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminProductDetailRequest = AuthenticatedRequest &
  AdminProductScopeRequest & {
    productId: string;
  };

export type AdminProductStatusRequest = AuthenticatedRequest & {
  productId: string;
  status: CatalogStatus;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminProductMediaUploadRequest = AuthenticatedRequest & {
  productId: string;
  replaceMediaId?: string;
  bytes: ArrayBuffer;
  mimeType: AdminProductMediaMimeType;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  expectedProductVersion: number;
  idempotencyKey: string;
};

export type AdminProductMediaUpdateRequest = AuthenticatedRequest & {
  productId: string;
  mediaId: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  expectedProductVersion: number;
  idempotencyKey: string;
};

export type AdminProductMediaRemoveRequest = AuthenticatedRequest & {
  productId: string;
  mediaId: string;
  expectedProductVersion: number;
  idempotencyKey: string;
};

export type AdminSkuCreateRequest = AuthenticatedRequest & {
  productId: string;
  code: string;
  name: string;
  sellableUnitId: string;
  sellQuantity: number;
  consumptionBaseQuantity: number;
  /** Required for delivery weight resolution when the Product base unit is not GRAM. */
  estimatedShippingWeightGrams?: number;
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
  estimatedShippingWeightGrams?: number;
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminSkuAvailabilityRequest = AuthenticatedRequest & {
  skuId: string;
  locationId: string;
  availabilityStatus: "AVAILABLE" | "UNAVAILABLE";
  expectedVersion: number;
  idempotencyKey: string;
};

export type AdminSkuPriceRequest = AuthenticatedRequest & {
  skuId: string;
  marketId: string;
  locationId: string;
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
 * Global Catalog administration requires global scope. A location-scoped
 * Product projection requires catalog plus inventory read authority for that
 * location; only exact-location price and local selling-status commands may be
 * performed from it. Prices are versioned inserts; history is never rewritten.
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
  createAdminProduct(request: AdminProductCreateRequest): Promise<RpcResult<AdminProductSummary>>;
  getAdminProduct(request: AdminProductDetailRequest): Promise<RpcResult<AdminProductDetail>>;
  updateAdminProduct(request: AdminProductUpdateRequest): Promise<RpcResult<AdminProductSummary>>;
  setAdminProductStatus(
    request: AdminProductStatusRequest,
  ): Promise<RpcResult<AdminProductSummary>>;
  uploadAdminProductMedia(
    request: AdminProductMediaUploadRequest,
  ): Promise<RpcResult<AdminProductMediaView>>;
  updateAdminProductMedia(
    request: AdminProductMediaUpdateRequest,
  ): Promise<RpcResult<AdminProductMediaView>>;
  removeAdminProductMedia(
    request: AdminProductMediaRemoveRequest,
  ): Promise<RpcResult<AdminProductMediaView>>;
  getAdminProductMediaContent(
    request: AdminProductMediaContentRequest,
  ): Promise<RpcResult<AdminProductMediaContent>>;
  createAdminSku(request: AdminSkuCreateRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
  updateAdminSku(request: AdminSkuUpdateRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
  setAdminSkuAvailability(
    request: AdminSkuAvailabilityRequest,
  ): Promise<RpcResult<AdminCatalogSkuSummary>>;
  setAdminSkuPrice(request: AdminSkuPriceRequest): Promise<RpcResult<AdminCatalogSkuSummary>>;
  getAdminSkuPrices(request: AdminSkuPricesRequest): Promise<RpcResult<AdminSkuPricesView>>;
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

export type AdminSkuPricesRequest = AuthenticatedRequest & { skuId: string; locationId: string };
export type AdminSkuPricesView = {
  skuId: string;
  locationId: string;
  marketId: string;
  currency: string;
  latestVersion: number;
  canManage: boolean;
  currentPriceMinor: number | null;
  history: ReadonlyArray<{
    version: number;
    amountMinor: number;
    currency: string;
    validFrom: number;
    validTo: number | null;
  }>;
};
