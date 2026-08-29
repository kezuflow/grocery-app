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
});
