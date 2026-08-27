import { describe, expect, it } from "vitest";
import {
  validateProduceCatalog,
  ProduceCatalogValidationError,
} from "./validate-produce-catalog.ts";
import type { ProduceSeedProduct } from "./produce-catalog-types.ts";

const ASSET_KEYS = ["chili-pepper-fruit-siling-labuyo.webp", "potato.webp"];

function chiliPack(overrides: Partial<ProduceSeedProduct> = {}): ProduceSeedProduct {
  return {
    id: "product-chili-pepper-fruit-siling-labuyo",
    slug: "chili-pepper-fruit-siling-labuyo",
    name: "Siling Labuyo",
    categoryCode: "AROMATICS_SPICES",
    description: "Fresh local chili peppers commonly used to season Filipino dishes.",
    media: { assetKey: "chili-pepper-fruit-siling-labuyo.webp", altText: "Siling labuyo chili peppers" },
    details: [
      { label: "Contents", value: "Approximately 10–15 peppers per pack.", sortOrder: 1 },
      { label: "Storage", value: "Keep refrigerated and use within a few days.", sortOrder: 2 },
    ],
    inventoryBaseUnit: "GRAM",
    variants: [
      {
        id: "sku-chili-pepper-fruit-siling-labuyo-pack",
        code: "CHILI_PEPPER_FRUIT_SILING_LABUYO_PACK",
        displayName: "1 pack",
        merchandisingLabel: "Pack",
        customerContentsNote: "Approximately 10–15 chili peppers per pack.",
        packingInstruction: "Pack 100 g per bag.",
        baseUnit: "GRAM",
        sellUnitCode: "G",
        sellQuantity: 100,
        inventoryQuantityBase: 100,
        priceMinor: 6500,
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}

describe("validateProduceCatalog", () => {
  it("accepts a complete chili pack manifest and summarizes it", () => {
    const validated = validateProduceCatalog({
      products: [chiliPack()],
      assetKeys: ["chili-pepper-fruit-siling-labuyo.webp"],
    });
    expect(validated.summary.productCount).toBe(1);
    expect(validated.summary.variantCount).toBe(1);
    expect(validated.summary.unpricedVariantCount).toBe(0);
    expect(validated.summary.unavailableSkuCount).toBe(0);
    expect(validated.summary.byCategory.AROMATICS_SPICES).toBe(1);
    expect(validated.summary.byMerchandisingLabel.Pack).toBe(1);
    expect(validated.summary.minPriceMinor).toBe(6500);
    expect(validated.summary.maxPriceMinor).toBe(6500);
  });

  it("sorts validated products deterministically for generation", () => {
    const potato: ProduceSeedProduct = {
      ...chiliPack({
        id: "product-potato",
        slug: "potato",
        name: "Potato",
        categoryCode: "ROOTS_TUBERS_BULBS",
        media: { assetKey: "potato.webp", altText: "Potatoes" },
      }),
      variants: [
        {
          id: "sku-potato-500g",
          code: "POTATO_500G",
          displayName: "500 g",
          baseUnit: "GRAM",
          sellUnitCode: "G",
          sellQuantity: 500,
          inventoryQuantityBase: 500,
          priceMinor: 5500,
          sortOrder: 1,
        },
      ],
    };
    const validated = validateProduceCatalog({
      products: [chiliPack(), potato],
      assetKeys: ASSET_KEYS,
    });
    // Category sort order first (aromatics after roots), then name, then id.
    expect(validated.products.map((product) => product.slug)).toEqual([
      "potato",
      "chili-pepper-fruit-siling-labuyo",
    ]);
  });

  it("aggregates every violation into one error with product context", () => {
    const duplicateAsset = chiliPack({ id: "product-duplicate-asset", slug: "duplicate-asset" });
    const missingAssetFile = chiliPack({
      id: "product-missing-asset-file",
      slug: "missing-asset-file",
      media: { assetKey: "no-such-produce.webp", altText: "Missing" },
    });
    const invalidCategory = chiliPack({
      id: "product-invalid-category",
      slug: "invalid-category",
      categoryCode: "MEATS" as never,
    });
    const nonpositivePrice = chiliPack({
      id: "product-nonpositive-price",
      slug: "nonpositive-price",
      variants: [
        {
          id: "sku-nonpositive-price-pack",
          code: "NONPOSITIVE_PRICE_PACK",
          displayName: "1 pack",
          merchandisingLabel: "Pack",
          customerContentsNote: "note",
          packingInstruction: "Pack 100 g per bag.",
          baseUnit: "GRAM",
          sellUnitCode: "G",
          sellQuantity: 0,
          inventoryQuantityBase: 0,
          priceMinor: -1,
          sortOrder: 1,
        },
      ],
    });
    const dimensionMismatch = chiliPack({
      id: "product-dimension-mismatch",
      slug: "dimension-mismatch",
      variants: [
        {
          id: "sku-dimension-mismatch-piece",
          code: "DIMENSION_MISMATCH_PIECE",
          displayName: "1 piece",
          baseUnit: "PIECE",
          sellUnitCode: "PC",
          sellQuantity: 1,
          inventoryQuantityBase: 1,
          priceMinor: 2500,
          sortOrder: 1,
        },
      ],
    });
    const missingPackingInstruction = chiliPack({
      id: "product-missing-packing-instruction",
      slug: "missing-packing-instruction",
      variants: [
        {
          id: "sku-missing-packing-instruction-pack",
          code: "MISSING_PACKING_INSTRUCTION_PACK",
          displayName: "1 pack",
          merchandisingLabel: "Bunch",
          baseUnit: "GRAM",
          sellUnitCode: "G",
          sellQuantity: 100,
          inventoryQuantityBase: 100,
          priceMinor: 4500,
          sortOrder: 1,
        },
      ],
    });

    let caught: unknown;
    try {
      validateProduceCatalog({
        products: [
          chiliPack(),
          duplicateAsset,
          missingAssetFile,
          invalidCategory,
          nonpositivePrice,
          dimensionMismatch,
          missingPackingInstruction,
        ],
        assetKeys: ASSET_KEYS,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProduceCatalogValidationError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toMatch(/duplicate asset/s);
    expect(message).toMatch(/missing asset/s);
    expect(message).toMatch(/dimension/s);
    expect(message).toMatch(/packing instruction/s);
    expect(message).toContain("nonpositive-price");
    expect((caught as ProduceCatalogValidationError).violations.length).toBeGreaterThanOrEqual(6);
  });

  it("rejects duplicate identifiers, slugs, codes, bad naming, and incomplete metadata", () => {
    const cases: Array<{ products: ProduceSeedProduct[]; pattern: RegExp }> = [
      {
        products: [chiliPack(), chiliPack({ id: "product-other", slug: "chili-pepper-fruit-siling-labuyo" })],
        pattern: /duplicate slug/,
      },
      {
        products: [
          chiliPack(),
          chiliPack({
            id: "product-chili-copy",
            slug: "chili-copy",
            variants: [
              {
                id: "sku-chili-copy",
                code: "CHILI_PEPPER_FRUIT_SILING_LABUYO_PACK",
                displayName: "1 pack",
                merchandisingLabel: "Pack",
                customerContentsNote: "n",
                packingInstruction: "p",
                baseUnit: "GRAM",
                sellUnitCode: "G",
                sellQuantity: 100,
                inventoryQuantityBase: 100,
                priceMinor: 6000,
                sortOrder: 1,
              },
            ],
          }),
        ],
        pattern: /duplicate SKU code/,
      },
      {
        products: [chiliPack({ id: "Product-Chili" })],
        pattern: /kebab-case/,
      },
      {
        products: [chiliPack({ description: "" })],
        pattern: /description/,
      },
      {
        products: [chiliPack({ details: [{ label: "Storage", value: "x", sortOrder: 1 }] })],
        pattern: /Contents/i,
      },
      {
        products: [chiliPack({ media: { assetKey: ASSET_KEYS[0]!, altText: "" } })],
        pattern: /alt text/i,
      },
    ];
    for (const testCase of cases) {
      expect(() =>
        validateProduceCatalog({ products: testCase.products, assetKeys: ASSET_KEYS }),
      ).toThrowError(testCase.pattern);
    }
  });

  it("rejects approximate content ranges as authoritative consumption", () => {
    const rangedRecipe = chiliPack({
      id: "product-ranged-recipe",
      slug: "ranged-recipe",
      variants: [
        {
          id: "sku-ranged-recipe-pack",
          code: "RANGED_RECIPE_PACK",
          displayName: "1 pack",
          merchandisingLabel: "Pack",
          customerContentsNote: "10–15 peppers",
          packingInstruction: "Pack 80–120 g per bag.",
          baseUnit: "GRAM",
          sellUnitCode: "G",
          sellQuantity: 80,
          inventoryQuantityBase: 120,
          priceMinor: 6000,
          sortOrder: 1,
        },
      ],
    });
    // Sell quantity must equal the exact gram recipe for assembled packs; a
    // range cannot serve as authoritative consumption.
    expect(() =>
      validateProduceCatalog({ products: [rangedRecipe], assetKeys: ASSET_KEYS }),
    ).toThrowError(/exact.*recipe|range/s);
  });
});
