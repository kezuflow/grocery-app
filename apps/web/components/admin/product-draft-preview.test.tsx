import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductDraftPreview } from "./product-draft-preview";

describe("ProductDraftPreview", () => {
  it("previews entered customer-facing facts without inventing a price", () => {
    const html = renderToStaticMarkup(
      <ProductDraftPreview
        categoryName="Vegetables"
        value={{
          name: "Zucchini",
          slug: "zucchini",
          description: "Fresh locally sourced zucchini.",
          categoryId: "vegetables",
          inventoryBaseUnitId: "unit-gram",
          status: "active",
          customerDetails: [],
          media: [],
          variants: [
            {
              id: "variant-1",
              code: "ZUCCHINI_250G",
              name: "250 g bag",
              sellableUnitId: "unit-gram",
              sellQuantity: "250",
              merchandisingLabel: "",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Product preview");
    expect(html).toContain("Zucchini");
    expect(html).toContain("Vegetables");
    expect(html).toContain("Fresh locally sourced zucchini.");
    expect(html).toContain("250 g bag");
    expect(html).toContain("configured after the Product and its options exist");
    expect(html).not.toContain("₱");
  });
});
