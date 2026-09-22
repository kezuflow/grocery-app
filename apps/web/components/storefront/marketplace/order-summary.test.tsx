import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CartView, CheckoutQuoteView } from "@freshmarkets/contracts";
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
const quote: CheckoutQuoteView = {
  quoteId: "quote-1",
  attemptVersion: 1,
  priceAcceptanceVersion: 1,
  expiresAt: "2026-09-19T12:00:00.000Z",
  currency: "PHP",
  merchandiseSubtotalMinor: 17_000,
  itemDiscountMinor: 1_000,
  orderDiscountMinor: 0,
  deliverySubtotalMinor: 2_000,
  deliveryDiscountMinor: 0,
  taxMinor: 500,
  subtotalMinor: 19_000,
  discountMinor: 1_000,
  deliveryFeeMinor: 2_000,
  totalMinor: 18_500,
  lines: [],
  requestedPromotionCodes: ["SAVE10", "OLD"],
  promotionFeedback: [
    { code: "SAVE10", status: "APPLIED", message: "Promotion applied" },
    { code: "OLD", status: "EXPIRED", message: "Promotion expired" },
  ],
  promotionApplications: [
    {
      promotionId: "promotion-save10",
      code: "SAVE10",
      name: "Fresh basket savings",
      component: "MERCHANDISE",
      benefitType: "ORDER_FIXED_DISCOUNT",
      amountMinor: 1_000,
      automatic: false,
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
    expect(html).toContain('class="fm-shine-text text-[var(--fm-text)]"');
    expect(html).toContain("Delivery fee pending");
    expect(html).toContain("blur-[4px]");
    expect(html).not.toContain("Calculated at checkout");
  });

  it("supports a flat checkout presentation without a summary card", () => {
    const html = renderToStaticMarkup(
      <OrderSummary
        cart={cart}
        actionLabel="Continue"
        showItems
        onQuantityChange={vi.fn()}
        surface="flat"
      />,
    );

    expect(html).not.toContain("fm-shadow-card");
    expect(html).not.toContain("bg-[var(--fm-surface-soft)]");
  });

  it("labels a requested checkout quantity as pending while retaining authoritative totals", () => {
    const html = renderToStaticMarkup(
      <OrderSummary
        cart={cart}
        actionLabel="Continue"
        showItems
        onQuantityChange={vi.fn()}
        pendingQuantities={
          new Map([["sku-banana", { item: cart.items[0], quantity: 3, currency: "PHP" }]])
        }
        disabled
      />,
    );
    expect(html).toContain('aria-label="Updating quantity"');
    expect(html).toContain("animate-spin motion-reduce:animate-none");
    expect(html).toContain(">3</span>");
    expect(html).toContain("Items subtotal");
    expect(html).toContain("₱170.00");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Updating quantity…");
  });

  it("keeps applied and rejected promotion feedback in the quote-backed summary", () => {
    const html = renderToStaticMarkup(
      <OrderSummary cart={cart} quote={quote} actionLabel="Continue" />,
    );
    expect(html).toContain("Promo codes");
    expect(html).toContain("Applied savings");
    expect(html).toContain("Fresh basket savings");
    expect(html).toContain("SAVE10:");
    expect(html).toContain("Promotion applied");
    expect(html).toContain("OLD:");
    expect(html).toContain("Promotion expired");
    expect(html).toContain('href="/cart"');
    expect(html).toContain("Item discounts");
    expect(html).toContain("Delivery");
    expect(html).toContain("Tax");
    expect(html).toContain("₱185.00");
    expect(html).not.toContain("Order discount");
    expect(html).not.toContain("Delivery discount");
    expect(html).toContain("Current total valid until");
    expect(html).toContain("A missed delivery does not create an");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("duration-200");
  });
});
