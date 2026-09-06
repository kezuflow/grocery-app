import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./product-form";

describe("ProductForm", () => {
  it("uses the approved editor-and-aside composition without draft controls", () => {
    const html = renderToStaticMarkup(
      <ProductForm
        categories={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        pending={false}
        submitLabel="Create product"
        units={[]}
        value={{
          name: "",
          slug: "",
          description: null,
          categoryId: "",
          inventoryBaseUnitId: "",
          status: "active",
          statusReason: "",
          customerDetails: [],
          media: [],
          variants: [
            {
              id: "variant-1",
              code: "",
              name: "",
              sellableUnitId: "",
              sellQuantity: "",
              merchandisingLabel: "",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Product details");
    expect(html).toContain("Customer-facing details");
    expect(html).toContain("Product classification");
    expect(html).toContain("Create product");
    expect(html).not.toContain("Save draft");
    expect(html).not.toContain("Global customer-facing Product identity.");
    expect(html).not.toContain("Ordered facts such as Contents, Storage, or Origin.");
  });

  it("supports a single external create action without a second submit card", () => {
    const html = renderToStaticMarkup(
      <ProductForm
        formId="create-product-form"
        hideSubmit
        categories={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        pending={false}
        submitLabel="Create product"
        units={[]}
        value={{
          name: "",
          slug: "",
          description: null,
          categoryId: "",
          inventoryBaseUnitId: "",
          status: "active",
          statusReason: "",
          customerDetails: [],
          media: [],
          variants: [
            {
              id: "variant-1",
              code: "",
              name: "",
              sellableUnitId: "",
              sellQuantity: "",
              merchandisingLabel: "",
            },
          ],
        }}
      />,
    );
    expect(html).toContain('id="create-product-form"');
    expect(html).toContain("Product images");
    expect(html).toContain("Variants");
    expect(html).toContain("Add image");
    expect(html).toContain("Add variant");
    expect(html).toContain("Status");
    expect(html).toContain('<option value="active" selected="">Active</option>');
    expect(html).toContain('<option value="inactive">Inactive</option>');
    expect(html.indexOf("SKU")).toBeLessThan(html.indexOf("Variant name"));
    expect(html.indexOf("Variant name")).toBeLessThan(html.indexOf("Sell unit"));
    expect(html.indexOf("Sell unit")).toBeLessThan(html.indexOf("Quantity"));
    expect(html).not.toContain("Pricing and selling location");
    expect(html).not.toContain("Available at");
    expect(html).not.toContain("Price (");
    expect(html).not.toContain("Create product");
    expect(html).not.toContain("Save Product");
  });

  it("collects per-sold-unit shipping grams for count inventory", () => {
    const html = renderToStaticMarkup(
      <ProductForm
        categories={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        pending={false}
        submitLabel="Create product"
        units={[
          {
            unitId: "unit-piece",
            code: "PC",
            displayName: "Piece",
            dimension: "COUNT",
            canonicalBaseCode: "PIECE",
            conversionNumerator: 1,
            conversionDenominator: 1,
            status: "active",
            version: 1,
          },
        ]}
        value={{
          name: "Chili pepper",
          slug: "chili-pepper",
          description: null,
          categoryId: "category-produce",
          inventoryBaseUnitId: "unit-piece",
          status: "active",
          statusReason: "",
          customerDetails: [],
          media: [],
          variants: [
            {
              id: "variant-1",
              code: "CHILI-50G",
              name: "1 pack",
              sellableUnitId: "unit-piece",
              sellQuantity: "1",
              estimatedShippingWeightGrams: "50",
              merchandisingLabel: "",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Estimated shipping weight per sold unit (grams)");
    expect(html).toContain('value="50"');
  });

  it("does not offer inactive volume units for catalog authoring", () => {
    const html = renderToStaticMarkup(
      <ProductForm
        categories={[]}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        pending={false}
        submitLabel="Create product"
        units={[
          {
            unitId: "unit-gram",
            code: "GRAM",
            displayName: "Gram",
            dimension: "MASS",
            canonicalBaseCode: "GRAM",
            conversionNumerator: 1,
            conversionDenominator: 1,
            status: "active",
            version: 1,
          },
          {
            unitId: "unit-milliliter",
            code: "MILLILITER",
            displayName: "Milliliter",
            dimension: "VOLUME",
            canonicalBaseCode: "MILLILITER",
            conversionNumerator: 1,
            conversionDenominator: 1,
            status: "inactive",
            version: 2,
          },
        ]}
        value={{
          name: "Cooking oil",
          slug: "cooking-oil",
          description: null,
          categoryId: "category-grocery",
          inventoryBaseUnitId: "",
          status: "active",
          statusReason: "",
          customerDetails: [],
          media: [],
          variants: [],
        }}
      />,
    );
    expect(html).toContain("Gram (GRAM)");
    expect(html).not.toContain("Milliliter");
    expect(html).not.toContain("MILLILITER");
  });
});
