import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminProductDetail } from "@freshmarkets/contracts";
import { ProductDetailSummary } from "./product-detail-summary";

const product = {
  productId: "product-1",
  name: "Red onion",
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
  pricingContext: { marketId: "market-1", locationId: "location-1", currency: "PHP" },
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
      sourcingMode: "STOCKED",
    },
  ],
} as unknown as AdminProductDetail;

describe("ProductDetailSummary", () => {
  it("shows only authoritative Product media, SKU, price, and availability values", () => {
    const html = renderToStaticMarkup(<ProductDetailSummary product={product} />);
    expect(html).toContain("₱25.00");
    expect(html).toContain("Active SKUs");
    expect(html).toContain("1 / 1");
    expect(html).toContain("/media/media-1/content?v=2");
    expect(html).not.toContain("Revenue");
    expect(html).not.toContain("Orders");
  });
});
