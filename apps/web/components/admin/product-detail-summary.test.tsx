import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminProductDetail } from "@freshmarkets/contracts";
import { ProductDetailSummary } from "./product-detail-summary";

const product = {
  productId: "product-1",
  name: "Red onion",
  description: "Firm red onions for everyday cooking.",
  categoryName: "Roots, Tubers & Bulbs",
  status: "active",
  version: 3,
  customerDetails: [{ detailId: "detail-1", label: "Storage", value: "Keep cool.", sortOrder: 1 }],
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-gram",
    baseUnitCode: "GRAM",
    baseUnitSymbol: "g",
  },
  media: [
    {
      mediaId: "media-1",
      mimeType: "image/webp",
      altText: "Red onion",
      isPrimary: true,
      sortOrder: 1,
      status: "active",
      version: 2,
    },
  ],
  scope: {
    kind: "LOCATION",
    marketId: "market-1",
    marketName: "Metro Cebu",
    locationId: "location-1",
    locationName: "Central Cebu",
    currency: "PHP",
  },
  skus: [
    {
      skuId: "sku-1",
      code: "ONION_250G",
      name: "250 g",
      merchandisingLabel: null,
      unitSymbol: "g",
      sellQuantity: 250,
      consumptionBaseQuantity: 250,
      status: "active",
      sortOrder: 1,
      version: 1,
      priceMinor: 2_500,
      currency: "PHP",
      priceVersion: 1,
      availability: "AVAILABLE",
      availabilityVersion: 1,
    },
  ],
} as unknown as AdminProductDetail;

describe("ProductDetailSummary", () => {
  it("shows only authoritative Product media, variant, price, and availability values", () => {
    const html = renderToStaticMarkup(<ProductDetailSummary product={product} />);
    expect(html).toContain("₱25.00");
    expect(html).toContain("Active variants");
    expect(html).toContain("1 / 1");
    expect(html).toContain("/media/media-1/content?v=2");
    expect(html).toContain("Product overview");
    expect(html).toContain("Catalog facts");
    expect(html).toContain("Inventory base unit");
    expect(html).toContain("Central Cebu price");
    expect(html).not.toContain("Pricing context");
    expect(html).not.toContain("Revenue");
    expect(html).not.toContain("Orders");
  });
});
