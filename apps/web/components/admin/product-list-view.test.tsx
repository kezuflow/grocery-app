import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminProductPage } from "@freshmarkets/contracts";
import { ProductListView } from "./product-list-view";

const page: AdminProductPage = {
  items: [
    {
      productId: "product-onion",
      slug: "red-onion",
      name: "Red onion",
      categoryCode: "VEGETABLES",
      status: "active",
      skuCount: 2,
      activeSkuCount: 2,
      pricedSkuCount: 1,
      availableSkuCount: 0,
      primaryMedia: { mediaId: "media-1", altText: "Red onions", version: 2 },
      priceRange: { minimumMinor: 2_500, maximumMinor: 3_000, currency: "PHP" },
      version: 3,
    },
  ],
  readiness: {
    activeProducts: 1,
    inactiveProducts: 0,
    missingPrimaryMedia: 0,
    missingPrices: 1,
    unavailableSkus: 2,
  },
  pricingContext: {
    marketId: "market-metro-cebu",
    locationId: "location-cebu-central",
    currency: "PHP",
  },
  nextCursor: null,
};

describe("ProductListView", () => {
  it("renders catalog readiness, secure media, resolved prices, and availability", () => {
    const html = renderToStaticMarkup(<ProductListView page={page} fromQuery="status=active" />);
    expect(html).toContain("Catalog readiness");
    expect(html).toContain("Missing prices");
    expect(html).toContain("₱25.00–₱30.00");
    expect(html).toContain("0 / 2 available");
    expect(html).toContain("/api/admin/catalog/products/product-onion/media/media-1/content?v=2");
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("Rating");
  });
});
