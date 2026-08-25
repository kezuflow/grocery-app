import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "./index";

describe("catalog contracts", () => {
  it("represents fixed variants with integer base-unit consumption and versioned price", () => {
    const product: CatalogProduct = {
      id: "product-red-onion",
      slug: "red-onion",
      name: "Red onion",
      description: null,
      category: { code: "FRESH_PRODUCE", name: "Fresh produce", slug: "fresh-produce" },
      available: true,
      sourcingMode: "HYBRID",
      variants: [
        {
          id: "sku",
          code: "RED_ONION_500G",
          name: "500 g",
          unit: "g",
          consumptionBaseQuantity: 500,
          priceMinor: 12900,
          currency: "PHP",
          priceVersion: 1,
        },
      ],
    };
    expect(product.variants[0].consumptionBaseQuantity).toBe(500);
  });
});
