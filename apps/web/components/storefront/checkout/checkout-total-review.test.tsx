import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CheckoutQuoteView } from "@freshmarkets/contracts";
import { CheckoutTotalReview } from "./checkout-total-review";

const quote: CheckoutQuoteView = {
  quoteId: "q1",
  attemptVersion: 1,
  priceAcceptanceVersion: 2,
  expiresAt: "2026-08-30T12:00:00.000Z",
  currency: "PHP",
  merchandiseSubtotalMinor: 10_000,
  itemDiscountMinor: 0,
  orderDiscountMinor: 1_000,
  deliverySubtotalMinor: 500,
  deliveryDiscountMinor: 500,
  taxMinor: 0,
  subtotalMinor: 10_000,
  discountMinor: 1_500,
  deliveryFeeMinor: 0,
  totalMinor: 9_000,
  lines: [],
  requestedPromotionCodes: ["SAVE10"],
  promotionFeedback: [],
  promotionApplications: [
    {
      promotionId: "p1",
      code: "SAVE10",
      name: "Save ten",
      component: "MERCHANDISE",
      benefitType: "ORDER_PERCENT_DISCOUNT",
      amountMinor: 1_000,
      automatic: false,
    },
    {
      promotionId: "p2",
      code: "AUTO-DELIVERY",
      name: "Free delivery",
      component: "DELIVERY",
      benefitType: "DELIVERY_FEE_WAIVER",
      amountMinor: 500,
      automatic: true,
    },
  ],
};

describe("CheckoutTotalReview", () => {
  it("renders Core financial components and labels automatic benefits", () => {
    const html = renderToStaticMarkup(<CheckoutTotalReview quote={quote} onAccept={vi.fn()} />);

    expect(html).toContain("Merchandise subtotal");
    expect(html).toContain("Merchandise promotion");
    expect(html).toContain("Delivery subtotal");
    expect(html).toContain("Delivery promotion");
    expect(html).toContain("Free delivery (automatically applied)");
    expect(html).toContain("₱90.00");
    expect(html).toContain("Accept total and continue to payment");
    expect(html).not.toContain("FreshMarkets Service Fee");
  });

  it("can defer the payment action to the persistent order summary", () => {
    const html = renderToStaticMarkup(
      <CheckoutTotalReview quote={quote} onAccept={vi.fn()} showAction={false} />,
    );

    expect(html).toContain("Payment review");
    expect(html).not.toContain("Accept total and continue to payment");
  });
});
