import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { OrderSummary } from "./order-summary";

const cart: CartView = {
  id: "cart-1",
  version: 1,
  currency: "PHP",
  totalMinor: 17_000,
  checkoutBlocked: false,
  blockingReasons: [],
  items: [
    {
      skuId: "sku-banana",
      name: "Banana · 1 kg",
      quantity: 2,
      availability: "AVAILABLE",
      unitPriceMinor: 8_500,
      lineTotalMinor: 17_000,
      media: { src: "/media/products/banana/1", alt: "Fresh bananas" },
    },
  ],
};

describe("OrderSummary", () => {
  it("renders the guided checkout item preview with media and editable quantity", () => {
    const html = renderToStaticMarkup(
      <OrderSummary cart={cart} actionLabel="Continue" showItems onQuantityChange={vi.fn()} />,
    );

    expect(html).toContain("Order summary");
    expect(html).toContain("Fresh bananas");
    expect(html).toContain("Banana · 1 kg");
    expect(html).toContain('aria-label="Decrease Banana · 1 kg"');
    expect(html).toContain('aria-label="Increase Banana · 1 kg"');
    expect(html).toContain("text-right");
    expect(html).toContain("Items subtotal");
  });
});
