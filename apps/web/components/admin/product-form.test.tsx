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
          customerDetails: [],
        }}
      />,
    );
    expect(html).toContain("Product details");
    expect(html).toContain("Customer-facing details");
    expect(html).toContain("Product classification");
    expect(html).toContain("Create product");
    expect(html).not.toContain("Save draft");
  });
});
