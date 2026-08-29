import { describe, expect, it } from "vitest";
import {
  catalogStatuses,
  sourcingModes,
  type AdminUnitCreateRequest,
  type AdminUnitSummary,
  type AdminProductDetail,
  type AdminCatalogSkuSummary,
  type AdminSkuPriceRequest,
} from "./admin-catalog";

describe("catalog contracts", () => {
  it("publishes the closed catalog status vocabulary", () => {
    expect(catalogStatuses).toEqual(["active", "inactive"]);
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
      slug: "red-onion",
      name: "Red Onion",
      description: null,
      categoryCode: "FRESH_PRODUCE",
      categoryName: "Fresh produce",
      status: "active",
      version: 2,
      skus: [],
    } satisfies AdminProductDetail);
  });
});
