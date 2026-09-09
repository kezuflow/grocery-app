import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AmendmentFlow } from "./amendment-flow";

describe("AmendmentFlow", () => {
  it("starts with named product search without asking for internal SKU codes", () => {
    const html = renderToStaticMarkup(
      <AmendmentFlow orderId="order-1" orderVersion={4} available />,
    );
    expect(html).toContain("Add items before cutoff");
    expect(html).toContain("Find a product");
    expect(html).toContain("Search products");
    expect(html).not.toContain("SKU code");
  });
});
