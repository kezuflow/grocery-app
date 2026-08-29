import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { validateProduceCatalog } from "./validate-produce-catalog.ts";
import { produceCatalog } from "./produce-catalog.ts";

/**
 * Real-directory integrity gate: the committed manifest must cover every
 * public produce asset exactly once before generation may run. The sorted
 * asset list is read once on the Node side of the vitest harness and injected
 * as a binding, so the check runs against the actual public directory.
 */
describe("produce catalog manifest integrity", () => {
  const assetKeys = (
    JSON.parse((env as unknown as { PRODUCE_ASSET_KEYS: string }).PRODUCE_ASSET_KEYS) as string[]
  ).sort();

  it("covers exactly the 226 public produce assets", () => {
    expect(assetKeys).toHaveLength(226);
    const validated = validateProduceCatalog({ products: produceCatalog, assetKeys });
    expect(validated.products).toHaveLength(226);
    expect(new Set(validated.products.map((product) => product.media.assetKey))).toEqual(
      new Set(assetKeys),
    );
    expect(validated.summary.unpricedVariantCount).toBe(0);
    expect(validated.summary.unavailableSkuCount).toBe(0);
  });

  it("keeps launch prices plausible and reports the category distribution", () => {
    const validated = validateProduceCatalog({ products: produceCatalog, assetKeys });
    const { summary } = validated;
    expect(summary.minPriceMinor ?? 0).toBeGreaterThanOrEqual(2000);
    expect(summary.maxPriceMinor ?? Infinity).toBeLessThanOrEqual(60000);

    // Deterministic order and reusable identity hygiene surfaced for review.
    console.info(
      "[produce-catalog] summary:",
      JSON.stringify(
        {
          byCategory: summary.byCategory,
          byBaseUnit: summary.byBaseUnit,
          byMerchandisingLabel: summary.byMerchandisingLabel,
          variantCount: summary.variantCount,
          priceRangeByCategory: summary.priceRangeByCategory,
        },
        null,
        2,
      ),
    );
    const reusedSlugs = [
      "red-onion",
      "avocado",
      "banana-lakatan",
      "mango-carabao",
      "strawberry",
      "pineapple",
      "watermelon",
      "calamansi",
      "papaya",
      "tomato",
      "carrot",
      "broccoli",
      "cucumber",
      "cabbage",
      "eggplant",
      "kangkong",
      "pechay",
      "garlic",
    ];
    for (const slug of reusedSlugs) {
      const product = validated.products.find((candidate) => candidate.slug === slug);
      expect(product, `reused product ${slug}`).toBeTruthy();
      if (!product) continue;
      for (const variant of product.variants) {
        expect(variant.id).toBe(`sku-${variant.code.toLowerCase().replace(/_/g, "-")}`);
      }
    }
  });

  it("reconciles known overlapping products without duplicates", () => {
    const validated = validateProduceCatalog({ products: produceCatalog, assetKeys });
    const ids = validated.products.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("product-red-onion");
    expect(ids).toContain("product-cucumber");
    // The generic cucumber product reconciles to the plain asset while
    // Japanese cucumber stays its own product.
    const cucumber = validated.products.find((candidate) => candidate.slug === "cucumber");
    expect(cucumber?.media.assetKey).toBe("cucumber.webp");
    const slugs = validated.products.map((product) => product.slug);
    expect(slugs).toContain("japanese-cucumber");
    expect(new Set(slugs).size).toBe(slugs.length);
    // The chili pack example keeps its assembled 100 g recipe identity.
    const chili = validated.products.find(
      (candidate) => candidate.slug === "chili-pepper-fruit-siling-labuyo",
    );
    expect(chili?.variants[0]?.merchandisingLabel).toBe("Pack");
    expect(chili?.variants[0]?.inventoryQuantityBase).toBe(100);
    expect(chili?.variants[0]?.customerContentsNote).toMatch(/10–15/);
    expect(chili?.variants[0]?.packingInstruction).toMatch(/100 g/);
  });
});
