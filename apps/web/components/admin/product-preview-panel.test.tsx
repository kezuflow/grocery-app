import type { AdminProductDetail } from "@freshmarkets/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductPreviewPanel } from "./product-preview-panel";

const product: AdminProductDetail = {
  productId: "product-1",
  categoryId: "category-1",
  slug: "zucchini",
  name: "Zucchini",
  description: "Fresh zucchini.",
  categoryCode: "VEGETABLES",
  categoryName: "Vegetables",
  status: "active",
  version: 3,
  customerDetails: [],
  media: [
    {
      mediaId: "media-1",
      mimeType: "image/webp",
      altText: "Zucchini",
      isPrimary: true,
      sortOrder: 1,
      status: "active",
      version: 2,
    },
  ],
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-gram",
    baseUnitCode: "GRAM",
    baseUnitSymbol: "g",
    position: null,
  },
  scope: {
    kind: "LOCATION",
    marketId: "market-1",
    marketName: "Metro Cebu",
    locationId: "location-1",
    locationName: "Central Cebu",
    currency: "PHP",
  },
  allowedActions: ["UPDATE", "SET_STATUS"],
  recentAudit: [],
  skus: [
    {
      skuId: "sku-1",
      code: "ZUCCHINI_1KG",
      name: "Zucchini · 1 kg",
      merchandisingLabel: null,
      unitSymbol: "kg",
      sellQuantity: 1,
      consumptionBaseQuantity: 1_000,
      estimatedShippingWeightGrams: 1_000,
      status: "active",
      sortOrder: 1,
      version: 1,
      priceMinor: 8_500,
      currency: "PHP",
      priceVersion: 1,
      availability: "AVAILABLE",
      availabilityVersion: 1,
    },
  ],
};

describe("ProductPreviewPanel", () => {
  it("renders the selected product's authoritative preview and actions", () => {
    const html = renderToStaticMarkup(
      <ProductPreviewPanel product={product} fromQuery="status=active" onClose={() => {}} />,
    );

    expect(html).toContain('id="product-panel-title"');
    expect(html).toContain("Product preview");
    expect(html).toContain(
      'class="mt-6 flex items-center justify-between gap-3 border-t border-[var(--fm-border)] pt-5"',
    );
    expect(html).not.toContain("min-h-11 items-center rounded-lg border");
    expect(html).toContain("Zucchini");
    expect(html).toContain("Vegetables");
    expect(html).toContain("Selling options");
    expect(html).toContain("Zucchini · 1 kg");
    expect(html).toContain("₱85.00");
    expect(html).toContain("Add selling option");
    expect(html).toContain("View product");
    expect(html).toContain("Edit");
    expect(html).toContain("Catalog version");
    expect(html).toContain("Last recorded change");
    expect(html).toContain("/media/media-1/content?v=2&amp;locationId=location-1");
    expect(html).not.toContain("Date added");
  });
});
