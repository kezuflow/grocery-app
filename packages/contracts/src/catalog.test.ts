import { describe, expect, it } from "vitest";
import type {
  CatalogProduct,
  CatalogSearchRequest,
  CatalogVariant,
  MarketplaceHomeRequest,
  MarketplaceHomeView,
} from "./index";

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "sku-chili-pepper-fruit-siling-labuyo-pack",
    code: "CHILI_PEPPER_FRUIT_SILING_LABUYO_PACK",
    name: "1 pack",
    merchandisingLabel: "Pack",
    sellQuantity: 100,
    sellUnitCode: "G",
    unit: "g",
    consumptionBaseQuantity: 100,
    contentsNote: "Approximately 10–15 chili peppers per pack.",
    priceMinor: 6500,
    currency: "PHP",
    priceVersion: 1,
    ...overrides,
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-chili-pepper-fruit-siling-labuyo",
    slug: "chili-pepper-fruit-siling-labuyo",
    name: "Siling Labuyo",
    description: "Fresh local chili peppers.",
    category: { code: "AROMATICS_SPICES", name: "Aromatics & Spices", slug: "aromatics-spices" },
    media: {
      src: "/produce/chili-pepper-fruit-siling-labuyo.webp",
      alt: "Fresh siling labuyo chili peppers",
    },
    details: [{ label: "Storage", value: "Keep refrigerated.", sortOrder: 1 }],
    available: true,
    variants: [variant()],
    ...overrides,
  };
}

describe("catalog contracts", () => {
  it("represents fixed variants with integer base-unit consumption and versioned price", () => {
    const weightOnly: CatalogVariant = variant({
      id: "sku-red-onion-500g",
      code: "RED_ONION_500G",
      name: "500 g",
      merchandisingLabel: null,
      contentsNote: null,
      sellQuantity: 500,
    });
    expect(weightOnly.consumptionBaseQuantity).toBe(100);
    expect(weightOnly.sellUnitCode).toBe("G");
    expect(weightOnly.priceMinor).toBe(6500);
  });

  it("carries core media and ordered customer-facing details on the product", () => {
    const item = product();
    expect(item.media?.src).toBe("/produce/chili-pepper-fruit-siling-labuyo.webp");
    expect(item.media?.alt).toContain("chili");
    expect(item.details[0]?.label).toBe("Storage");
    expect(item.details[0]?.sortOrder).toBe(1);
  });

  it("exposes the assembled pack merchandising label and approximate contents note", () => {
    const pack = product().variants[0]!;
    expect(pack.name).toBe("1 pack");
    expect(pack.merchandisingLabel).toBe("Pack");
    expect(pack.contentsNote).toContain("10–15 chili peppers");
    expect(JSON.stringify(pack)).not.toContain("packingInstruction");
  });

  it("keeps public DTOs free of operations packing instructions and sourcing mode", () => {
    const serialized = JSON.stringify(product());
    expect(serialized).not.toContain("packingInstruction");
    expect(serialized).not.toContain("sourcingMode");
    expect(serialized).not.toContain("PLANNED_PROCUREMENT");
  });

  it("describes marketplace home rails bounded by category", () => {
    const home: MarketplaceHomeView = {
      categories: [
        {
          code: "AROMATICS_SPICES",
          name: "Aromatics & Spices",
          slug: "aromatics-spices",
          iconSrc: "/category-icons/aromatics-spices.svg",
        },
      ],
      rails: [
        {
          code: "AROMATICS_SPICES",
          title: "Aromatics & Spices",
          categorySlug: "aromatics-spices",
          items: [product()],
        },
      ],
    };
    expect(home.rails[0]?.items).toHaveLength(1);
    expect(home.rails[0]?.categorySlug).toBe("aromatics-spices");
    expect(home.categories[0]?.iconSrc).toBe("/category-icons/aromatics-spices.svg");
  });

  it("accepts category, cursor, limit, and location filters on catalog search requests", () => {
    const request: CatalogSearchRequest & MarketplaceHomeRequest = {
      requestId: "req-catalog-search-1",
      query: "mango",
      categorySlug: "fruits",
      cursor: "eyJvcmRlckJ5Ijp7fX0",
      limit: 24,
      locationId: "location-cebu-central",
      itemsPerRail: 8,
    };
    expect(request.categorySlug).toBe("fruits");
    expect(request.cursor).toBeTruthy();
    expect(request.limit).toBe(24);
    expect(request.locationId).toBe("location-cebu-central");
  });
});
