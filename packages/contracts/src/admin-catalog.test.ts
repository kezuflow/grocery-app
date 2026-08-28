import { describe, expect, it } from "vitest";
import {
  catalogStatuses,
  type AdminCatalogProductDetail,
  type AdminCatalogSkuSummary,
} from "./admin-catalog";

describe("catalog contracts", () => {
  it("publishes the closed catalog status vocabulary", () => {
    expect(catalogStatuses).toEqual(["active", "inactive"]);
  });

  it("keeps catalog payloads as purpose-built DTOs", () => {
    void ({
      skuId: "sku-1",
      code: "RED-ONION-250G",
      name: "250 g",
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
    } satisfies AdminCatalogSkuSummary);
    void ({
      productId: "prod-1",
      slug: "red-onion",
      name: "Red Onion",
      categoryCode: "FRESH_PRODUCE",
      categoryName: "Fresh produce",
      status: "active",
      skus: [],
    } satisfies AdminCatalogProductDetail);
  });
});
