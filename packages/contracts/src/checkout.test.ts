import { describe, expect, it } from "vitest";
import type { CheckoutQuoteView } from "./index";

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
});
