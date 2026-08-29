import { describe, expect, it } from "vitest";
import { assertQuoteFinancialSnapshot, type QuoteFinancialSnapshot } from "./quote";

const valid: QuoteFinancialSnapshot = {
  merchandiseSubtotalMinor: 20_000,
  itemDiscountMinor: 500,
  orderDiscountMinor: 1_000,
  deliverySubtotalMinor: 2_000,
  deliveryDiscountMinor: 500,
  serviceFeeMinor: 200,
  taxMinor: 0,
  totalMinor: 20_200,
  currency: "PHP",
};

describe("quote financial snapshots", () => {
  it("accepts an exact integer component total", () => {
    expect(() => assertQuoteFinancialSnapshot(valid)).not.toThrow();
  });

  it("rejects totals that do not equal their explicit components", () => {
    expect(() =>
      assertQuoteFinancialSnapshot({ ...valid, totalMinor: valid.totalMinor + 1 }),
    ).toThrow("QUOTE_FINANCIAL_TOTAL_INVALID");
  });

  it("rejects discounts that exceed their owned component", () => {
    expect(() =>
      assertQuoteFinancialSnapshot({
        ...valid,
        deliveryDiscountMinor: valid.deliverySubtotalMinor + 1,
        totalMinor: 19_699,
      }),
    ).toThrow("QUOTE_FINANCIAL_DISCOUNT_INVALID");
  });
});
