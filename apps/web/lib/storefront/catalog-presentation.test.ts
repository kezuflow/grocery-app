import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogProduct, CatalogVariant } from "@freshmarkets/contracts";
import {
  formatMoney,
  pickDefaultVariant,
  railEligible,
  toPresentationProduct,
} from "./catalog-presentation";

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  const id = overrides.id ?? "v-default";
  return {
    id,
    code: id.toUpperCase(),
    name: overrides.name ?? "500 g",
    merchandisingLabel: null,
    sellQuantity: 500,
    sellUnitCode: "G",
    unit: "g",
    consumptionBaseQuantity: 500,
    contentsNote: null,
    priceMinor: 9450,
    currency: "PHP",
    priceVersion: 1,
    ...overrides,
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-red-onion",
    slug: "red-onion",
    name: "Red onion",
    description: "Fresh red onions.",
    category: { code: "ROOTS_TUBERS_BULBS", name: "Roots, Tubers & Bulbs", slug: "roots-tubers-bulbs" },
    media: { src: "/produce/onion-red-creole-bermuda-red.webp", alt: "Fresh red onions in a basket" },
    details: [
      { label: "Contents", value: "Fixed sizes: 250 g, 500 g, 1 kg.", sortOrder: 1 },
      { label: "Storage", value: "Store in a cool, dry place.", sortOrder: 2 },
    ],
    available: true,
    variants: [
      variant({ id: "v-250", name: "250 g", consumptionBaseQuantity: 250, priceMinor: 6450 }),
      variant({ id: "v-500", name: "500 g", consumptionBaseQuantity: 500, priceMinor: 12900 }),
      variant({ id: "v-1000", name: "1 kg", consumptionBaseQuantity: 1000, priceMinor: 25800 }),
    ],
    ...overrides,
  };
}

describe("pickDefaultVariant", () => {
  it("prefers the mass size closest to everyday 500 g", () => {
    const picked = pickDefaultVariant(product().variants);
    expect(picked?.id).toBe("v-500");
    expect(picked?.label).toBe("500 g");
  });

  it("leads assembled packs through their merchandising metadata", () => {
    const pack = variant({
      id: "v-pack",
      name: "1 pack",
      merchandisingLabel: "Pack",
      sellUnitCode: "G",
      sellQuantity: 100,
      consumptionBaseQuantity: 100,
      priceMinor: 6500,
      contentsNote: "Approximately 10–15 chili peppers per pack.",
    });
    const picked = pickDefaultVariant([pack]);
    expect(picked?.id).toBe("v-pack");
    expect(picked?.merchandisingLabel).toBe("Pack");
    expect(picked?.contentsNote).toContain("10–15");
  });

  it("ignores unpriced variants even when larger", () => {
    const variants = [variant({ id: "v-250", priceMinor: null, currency: null }), variant({ id: "v-500" })];
    expect(pickDefaultVariant(variants)?.id).toBe("v-500");
  });

  it("returns null when no variant carries a valid price", () => {
    const variants = [variant({ id: "v-500", priceMinor: null, currency: null })];
    expect(pickDefaultVariant(variants)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats PHP minor units as peso", () => {
    assert.equal(formatMoney(12900, "PHP"), "₱129.00");
    assert.equal(formatMoney(6500, "PHP"), "₱65.00");
  });

  it("reports unavailable without a currency", () => {
    assert.equal(formatMoney(9450, null), "Unavailable");
  });
});

describe("toPresentationProduct", () => {
  it("carries core media, ordered details, and fixed variants verbatim", () => {
    const presentation = toPresentationProduct(product());
    expect(presentation.slug).toBe("red-onion");
    expect(presentation.categorySlug).toBe("roots-tubers-bulbs");
    expect(presentation.media?.src).toBe("/produce/onion-red-creole-bermuda-red.webp");
    expect(presentation.media?.alt).toContain("red onions");
    expect(presentation.details.map((detail) => detail.label)).toEqual(["Contents", "Storage"]);
    expect(presentation.defaultVariant?.priceMinor).toBe(12900);
    expect(presentation.variants.length).toBe(3);
  });

  it("falls back to null media so surfaces render the accessible placeholder", () => {
    const presentation = toPresentationProduct(product({ media: null }));
    expect(presentation.media).toBeNull();
  });

  it("keeps missing prices unavailable instead of zero", () => {
    const presentation = toPresentationProduct(
      product({ variants: [variant({ id: "v-500", priceMinor: null, currency: null })] }),
    );
    expect(presentation.defaultVariant).toBeNull();
  });

  it("maps a chili pack end to end from contract data", () => {
    const chili = toPresentationProduct(
      product({
        id: "product-chili-pepper-fruit-siling-labuyo",
        slug: "chili-pepper-fruit-siling-labuyo",
        name: "Siling Labuyo",
        media: {
          src: "/produce/chili-pepper-fruit-siling-labuyo.webp",
          alt: "Siling labuyo chili peppers",
        },
        variants: [
          variant({
            id: "sku-chili-pepper-fruit-siling-labuyo-pack",
            name: "1 pack",
            merchandisingLabel: "Pack",
            sellQuantity: 100,
            consumptionBaseQuantity: 100,
            priceMinor: 6500,
            contentsNote: "Approximately 10–15 chili peppers per pack.",
          }),
        ],
      }),
    );
    expect(chili.defaultVariant?.label).toBe("1 pack");
    expect(chili.defaultVariant?.contentsNote).toMatch(/10–15 chili peppers/);
    expect(chili.media?.src).toBe("/produce/chili-pepper-fruit-siling-labuyo.webp");
  });
});

describe("railEligible", () => {
  it("excludes unavailable products and products without a priced variant", () => {
    const items = [
      toPresentationProduct(product()),
      toPresentationProduct(product({ id: "p-2", available: false })),
      toPresentationProduct(
        product({ id: "p-3", variants: [variant({ id: "v-500", priceMinor: null, currency: null })] }),
      ),
    ];
    const eligible = railEligible(items);
    expect(eligible.length).toBe(1);
    expect(eligible[0]?.id).toBe("product-red-onion");
  });
});

describe("catalog media integrity", () => {
  it("contains no hard-coded slug-to-image map", async () => {
    const source = readFileSync(new URL("./catalog-presentation.ts", import.meta.url), "utf8");
    expect(source.includes("imageBySlug")).toBe(false);
  });
});
