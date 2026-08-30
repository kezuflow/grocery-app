import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderIssueForm } from "./order-issue-form";

describe("OrderIssueForm", () => {
  it("renders semantic bounded inputs and affected order lines", () => {
    const html = renderToStaticMarkup(
      <OrderIssueForm
        orderId="order-1"
        available
        items={[
          {
            orderItemId: "line-1",
            skuId: "sku-1",
            productName: "Red onion",
            variantName: "500 g",
            unit: "pack",
            quantity: 1,
            baseQuantity: 500,
            unitPriceMinor: 10000,
            lineTotalMinor: 10000,
          },
        ]}
      />,
    );
    expect(html).toContain('for="issue-category"');
    expect(html).toContain("Poor quality");
    expect(html).toContain("Red onion");
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain("0/1000 characters");
    expect(html).toContain("Submit issue");
  });
});
