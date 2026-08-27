import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { CatalogProduct, CatalogVariant } from "@freshmarkets/contracts";
import {
  formatMoney,
  pickDefaultVariant,
  railEligible,
  toPresentationProduct,
} from "./catalog-presentation";

function variant(
  id: string,
  label: string,
  consumptionBaseQuantity: number,
  priceMinor: number | null,
  currency: string | null = "PHP",
): CatalogVariant {
  return {
    id,
    code: id.toUpperCase(),
    name: label,
    merchandisingLabel: null,
    sellQuantity: consumptionBaseQuantity,
    sellUnitCode: "G",
    unit: "g",
    consumptionBaseQuantity,
    contentsNote: null,
    priceMinor,
    currency,
    priceVersion: priceMinor === null ? null : 1,
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-1",
    slug: "avocado",
    name: "Creamy Avocado",
    description: "Rich Cebu-grown avocados.",
    category: { code: "FRESH_FRUITS", name: "Fruits", slug: "fruits" },
    media: null,
    details: [],
    available: true,
    sourcingMode: "STOCKED",
    variants: [
      variant("v-250", "250 g", 250, 4700),
      variant("v-500", "500 g", 500, 9450),
      variant("v-1000", "1 kg", 1000, 18900),
    ],
    ...overrides,
  };
}

describe("pickDefaultVariant", () => {
  it("prefers the mass pack closest to 500 base units", () => {
    const picked = pickDefaultVariant(product().variants);
    assert.equal(picked?.id, "v-500");
    assert.equal(picked?.label, "500 g");
  });

  it("takes the first priced variant for counted packs", () => {
    const variants = [variant("v-6", "6 pack", 6, 7800), variant("v-12", "12 pack", 12, 14900)];
    assert.equal(pickDefaultVariant(variants)?.id, "v-6");
  });

  it("ignores unpriced variants even when larger", () => {
    const variants = [
      variant("v-250", "250 g", 250, null, null),
      variant("v-500", "500 g", 500, 9450),
    ];
    assert.equal(pickDefaultVariant(variants)?.id, "v-500");
  });

  it("returns null when no variant carries a valid price", () => {
    const variants = [variant("v-500", "500 g", 500, null, null)];
    assert.equal(pickDefaultVariant(variants), null);
  });
});

describe("formatMoney", () => {
  it("formats PHP minor units as peso", () => {
    assert.equal(formatMoney(9450, "PHP"), "₱94.50");
    assert.equal(formatMoney(50000, "PHP"), "₱500.00");
  });

  it("reports unavailable without a currency", () => {
    assert.equal(formatMoney(9450, null), "Unavailable");
  });
});

describe("toPresentationProduct", () => {
  it("maps contract fields into the presentation shape", () => {
    const presentation = toPresentationProduct(product());
    assert.equal(presentation.slug, "avocado");
    assert.equal(presentation.categoryName, "Fruits");
    assert.equal(presentation.categorySlug, "fruits");
    assert.equal(presentation.defaultVariant?.priceMinor, 9450);
    assert.equal(presentation.image, "/produce/avocado.webp");
    assert.equal(presentation.variants.length, 3);
  });

  it("falls back to the placeholder image for unmapped slugs", () => {
    const presentation = toPresentationProduct(product({ slug: "farm-eggs" }));
    assert.equal(presentation.image, null);
  });

  it("keeps missing prices unavailable instead of zero", () => {
    const presentation = toPresentationProduct(
      product({ variants: [variant("v-500", "500 g", 500, null, null)] }),
    );
    assert.equal(presentation.defaultVariant, null);
  });
});

describe("railEligible", () => {
  it("excludes unavailable products and products without a priced variant", () => {
    const items = [
      toPresentationProduct(product()),
      toPresentationProduct(product({ id: "p-2", available: false })),
      toPresentationProduct(
        product({ id: "p-3", variants: [variant("v-500", "500 g", 500, null, null)] }),
      ),
    ];
    const eligible = railEligible(items);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0]?.id, "product-1");
  });
});

describe("image map integrity", () => {
  it("resolves every curated slug deterministically", () => {
    const presentation = toPresentationProduct(product({ slug: "kangkong" }));
    expect(presentation.image).toBe("/produce/kangkong-swamp-cabbage.webp");
  });
});
