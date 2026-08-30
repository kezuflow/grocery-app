import { describe, expect, it } from "vitest";
import type {
  AbandonCheckoutAttemptRequest,
  AbandonCheckoutResult,
  CheckoutQuoteView,
  PaymentIntentCommandRequest,
} from "./index";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

describe("checkout contracts", () => {
  it("requires every canonical quote financial component", () => {
    type ExplicitFinancialComponents = Expect<
      Equal<
        Pick<
          CheckoutQuoteView,
          | "merchandiseSubtotalMinor"
          | "itemDiscountMinor"
          | "orderDiscountMinor"
          | "deliverySubtotalMinor"
          | "deliveryFeeMinor"
          | "deliveryDiscountMinor"
          | "serviceFeeMinor"
          | "taxMinor"
          | "totalMinor"
        >,
        {
          merchandiseSubtotalMinor: number;
          itemDiscountMinor: number;
          orderDiscountMinor: number;
          deliverySubtotalMinor: number;
          deliveryFeeMinor: number;
          deliveryDiscountMinor: number;
          serviceFeeMinor: number;
          taxMinor: number;
          totalMinor: number;
        }
      >
    >;

    void (true as ExplicitFinancialComponents);
    expect(true).toBe(true);
  });

  it("carries promotion feedback and an explicit price-acceptance version", () => {
    const view = {
      priceAcceptanceVersion: 2,
      requestedPromotionCodes: ["SAVE10"],
      promotionFeedback: [{ code: "SAVE10", status: "APPLIED", message: "Promotion applied" }],
      promotionApplications: [
        {
          promotionId: "promotion-1",
          code: "SAVE10",
          name: "Save ten",
          component: "MERCHANDISE",
          benefitType: "ORDER_PERCENT_DISCOUNT",
          amountMinor: 1000,
          automatic: false,
        },
      ],
    } satisfies Pick<
      CheckoutQuoteView,
      | "priceAcceptanceVersion"
      | "requestedPromotionCodes"
      | "promotionFeedback"
      | "promotionApplications"
    >;
    expect(view.promotionApplications[0]?.component).toBe("MERCHANDISE");
  });

  it("requires payment acceptance of the quote version and every canonical component", () => {
    const request = {
      requestId: "request-1",
      headers: {},
      checkoutAttemptId: "quote-1",
      expectedQuoteVersion: 1,
      expectedPriceAcceptanceVersion: 3,
      expectedCurrency: "PHP",
      expectedMerchandiseSubtotalMinor: 20_000,
      expectedItemDiscountMinor: 0,
      expectedOrderDiscountMinor: 1_000,
      expectedDeliverySubtotalMinor: 500,
      expectedDeliveryFeeMinor: 0,
      expectedDeliveryDiscountMinor: 500,
      expectedServiceFeeMinor: 0,
      expectedTaxMinor: 0,
      expectedTotalMinor: 19_000,
      returnUrl: "https://freshmarkets.ph/orders",
      idempotencyKey: "payment-1",
    } satisfies PaymentIntentCommandRequest;

    expect(request.expectedPriceAcceptanceVersion).toBe(3);
  });

  it("separates pre-commit abandonment from committed-order cancellation", () => {
    const request = {
      requestId: "request-abandon",
      headers: {},
      quoteId: "quote-1",
      expectedVersion: 2,
      idempotencyKey: "abandon-1",
    } satisfies AbandonCheckoutAttemptRequest;
    const result = {
      quoteId: request.quoteId,
      outcome: "ABANDONED",
      quoteStatus: "SUPERSEDED",
      releasedInventoryHolds: 1,
      releasedCapacityAllocations: 0,
    } satisfies AbandonCheckoutResult;
    expect(result.outcome).toBe("ABANDONED");
    expect(result).not.toHaveProperty("orderStatus");
  });
});
