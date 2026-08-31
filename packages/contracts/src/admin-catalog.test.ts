import { describe, expect, it } from "vitest";
import {
  catalogStatuses,
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
  sourcingModes,
  type AdminCategoryCreateRequest,
  type AdminCategoryDetail,
  type AdminCategoryStatusRequest,
  type AdminCategoryUpdateRequest,
  type AdminCatalogService,
  type AdminUnitCreateRequest,
  type AdminUnitSummary,
  type AdminProductDetail,
  type AdminProductCreateRequest,
  type AdminProductUpdateRequest,
  type AdminCatalogSkuSummary,
  type AdminSkuPriceRequest,
  type AdminProductMediaRemoveRequest,
  type AdminProductMediaUpdateRequest,
  type AdminProductMediaUploadRequest,
  type AdminProductListRequest,
  type AdminProductPage,
  type AdminProductMediaContentRequest,
  type AdminProductMediaContent,
} from "./admin-catalog";

describe("catalog contracts", () => {
  it("publishes the closed catalog status vocabulary", () => {
    expect(catalogStatuses).toEqual(["active", "inactive"]);
  });

  it("publishes bounded Product media commands without caller-controlled object keys", () => {
    expect(adminProductMediaMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(adminProductMediaMaxBytes).toBe(5_242_880);
    const upload = {
      requestId: "request-media-upload",
      headers: {},
      productId: "prod-1",
      bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      mimeType: "image/jpeg",
      altText: "Red onion",
      isPrimary: true,
      sortOrder: 1,
      expectedProductVersion: 2,
      idempotencyKey: "media-upload-1",
    } satisfies AdminProductMediaUploadRequest;
    void ({
      requestId: "request-media-update",
      headers: {},
      productId: "prod-1",
      mediaId: "media-1",
      altText: "Red onions",
      isPrimary: false,
      sortOrder: 2,
      expectedProductVersion: 3,
      idempotencyKey: "media-update-1",
    } satisfies AdminProductMediaUpdateRequest);
    void ({
      requestId: "request-media-remove",
      headers: {},
      productId: "prod-1",
      mediaId: "media-1",
      expectedProductVersion: 4,
      idempotencyKey: "media-remove-1",
    } satisfies AdminProductMediaRemoveRequest);
    expect(upload).not.toHaveProperty("objectKey");
  });

  it("publishes secure Product media reads without storage keys", () => {
    const request = {
      requestId: "request-media-content",
      headers: {},
      productId: "prod-1",
      mediaId: "media-1",
    } satisfies AdminProductMediaContentRequest;
    const content = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      mimeType: "image/jpeg",
      etag: '"digest-1"',
      version: 3,
    } satisfies AdminProductMediaContent;
    expect(request).not.toHaveProperty("objectKey");
    expect(content).not.toHaveProperty("objectKey");
  });

  it("requires explicit pricing context and publishes catalog readiness", () => {
    void ({
      requestId: "request-products",
      headers: {},
      marketId: "market-metro-cebu",
      locationId: "location-cebu-central",
    } satisfies AdminProductListRequest);
    void ({
      items: [
        {
          productId: "prod-1",
          slug: "red-onion",
          name: "Red onion",
          categoryCode: "FRESH_PRODUCE",
          status: "active",
          skuCount: 2,
          activeSkuCount: 2,
          pricedSkuCount: 1,
          availableSkuCount: 1,
          primaryMedia: { mediaId: "media-1", altText: "Red onion", version: 3 },
          priceRange: { minimumMinor: 2500, maximumMinor: 3000, currency: "PHP" },
          version: 2,
        },
      ],
      readiness: {
        activeProducts: 1,
        inactiveProducts: 0,
        missingPrimaryMedia: 0,
        missingPrices: 1,
        unavailableSkus: 1,
      },
      pricingContext: {
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
        currency: "PHP",
      },
      nextCursor: null,
    } satisfies AdminProductPage);
  });

  it("publishes canonical unit conversion and sourcing contracts", () => {
    expect(sourcingModes).toEqual(["STOCKED", "PLANNED", "ON_DEMAND", "MIXED"]);
    void ({
      requestId: "request-1",
      headers: {},
      code: "KG",
      displayName: "Kilogram",
      dimension: "MASS",
      canonicalBaseCode: "GRAM",
      conversionNumerator: 1000,
      conversionDenominator: 1,
      idempotencyKey: "unit-1",
    } satisfies AdminUnitCreateRequest);
    void ({
      unitId: "unit-kilogram",
      code: "KG",
      displayName: "Kilogram",
      dimension: "MASS",
      canonicalBaseCode: "GRAM",
      conversionNumerator: 1000,
      conversionDenominator: 1,
      status: "active",
      version: 1,
    } satisfies AdminUnitSummary);
  });

  it("keeps catalog payloads as purpose-built DTOs", () => {
    void ({
      requestId: "request-category-create",
      headers: {},
      code: "ROOTS",
      name: "Roots",
      slug: "roots",
      parentCategoryId: null,
      iconAssetKey: "roots.svg",
      sortOrder: 4,
      idempotencyKey: "category-create-1",
    } satisfies AdminCategoryCreateRequest);
    void ({
      requestId: "request-category-update",
      headers: {},
      categoryId: "category-roots",
      name: "Roots and tubers",
      slug: "roots-and-tubers",
      parentCategoryId: "category-produce",
      iconAssetKey: "roots.svg",
      sortOrder: 4,
      expectedVersion: 2,
      idempotencyKey: "category-update-1",
    } satisfies AdminCategoryUpdateRequest);
    void ({
      requestId: "request-category-status",
      headers: {},
      categoryId: "category-roots",
      status: "inactive",
      reason: "Seasonal catalog pause",
      expectedVersion: 3,
      idempotencyKey: "category-status-1",
    } satisfies AdminCategoryStatusRequest);
    void ({
      categoryId: "category-roots",
      code: "ROOTS",
      name: "Roots",
      slug: "roots",
      status: "active",
      sortOrder: 4,
      iconAssetKey: "roots.svg",
      parent: null,
      children: [],
      products: [],
      version: 1,
      allowedActions: ["UPDATE", "SET_STATUS"],
      recentAudit: [],
    } satisfies AdminCategoryDetail);
    void ({
      requestId: "request-product-create",
      headers: {},
      categoryId: "category-produce",
      slug: "red-onion",
      name: "Red onion",
      description: "Fresh red onions.",
      customerDetails: [{ label: "Storage", value: "Keep cool.", sortOrder: 1 }],
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: "product-create-1",
    } satisfies AdminProductCreateRequest);
    void ({
      requestId: "request-product-update",
      headers: {},
      productId: "prod-1",
      categoryId: "category-produce",
      slug: "red-onion",
      name: "Red Onion",
      description: null,
      customerDetails: [],
      expectedVersion: 2,
      idempotencyKey: "product-update-1",
    } satisfies AdminProductUpdateRequest);
    void ({
      requestId: "request-price",
      headers: {},
      skuId: "sku-1",
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "PHP",
      amountMinor: 2500,
      validFrom: 1000,
      expectedVersion: 3,
      idempotencyKey: "price-1",
    } satisfies AdminSkuPriceRequest);
    void ({
      skuId: "sku-1",
      code: "RED-ONION-250G",
      name: "250 g",
      merchandisingLabel: null,
      unitSymbol: "g",
      sellQuantity: 250,
      consumptionBaseQuantity: 250,
      status: "active",
      sortOrder: 1,
      version: 3,
      priceMinor: 2500,
      currency: "PHP",
      priceVersion: 4,
      availability: "AVAILABLE",
      availabilityVersion: 2,
      sourcingMode: "STOCKED",
    } satisfies AdminCatalogSkuSummary);
    void ({
      productId: "prod-1",
      categoryId: "category-produce",
      slug: "red-onion",
      name: "Red Onion",
      description: null,
      categoryCode: "FRESH_PRODUCE",
      categoryName: "Fresh produce",
      status: "active",
      version: 2,
      customerDetails: [],
      media: [],
      inventoryPool: {
        inventoryPoolId: "pool-1",
        baseUnitId: "unit-gram",
        baseUnitCode: "GRAM",
        baseUnitSymbol: "g",
      },
      pricingContext: {
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
        currency: "PHP",
      },
      allowedActions: ["UPDATE", "SET_STATUS"],
      recentAudit: [],
      skus: [],
    } satisfies AdminProductDetail);
  });

  it("does not publish a category deletion command", () => {
    const noDelete: "deleteAdminCategory" extends keyof AdminCatalogService ? false : true = true;
    expect(noDelete).toBe(true);
  });
});
