import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AmendmentFlow } from "./amendment-flow";

describe("AmendmentFlow", () => {
  it("presents additive quantity entry without claiming the original order changes", () => {
    const html = renderToStaticMarkup(
      <AmendmentFlow orderId="order-1" orderVersion={4} available />,
    );
    expect(html).toContain("Add items before cutoff");
    expect(html).toContain("SKU code");
    expect(html).toContain("Quantity");
    expect(html).toContain("Price addition");
  });
});
