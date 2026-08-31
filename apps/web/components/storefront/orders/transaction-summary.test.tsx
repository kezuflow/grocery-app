import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProvisionalTransactionSummaryView } from "@freshmarkets/contracts";
import { TransactionSummary } from "./transaction-summary";

function summary(source: "CHECKOUT_QUOTE" | "ORDER_TOTAL_ONLY"): ProvisionalTransactionSummaryView {
  const unavailable = source === "ORDER_TOTAL_ONLY" ? null : 0;
  return {
    documentKind: "PROVISIONAL_TRANSACTION_SUMMARY",
    disclaimer: "NOT AN OFFICIAL BIR INVOICE",
    orderNumber: "FM-1",
    committedAt: "2026-08-31T00:00:00.000Z",
    currency: "PHP",
    buyer: { recipient: "Ana", addressLines: ["Cebu City"] },
    lines: [],
    financial: {
      source,
      currency: "PHP",
      merchandiseSubtotalMinor: source === "ORDER_TOTAL_ONLY" ? null : 100_000,
      itemDiscountMinor: unavailable,
      orderDiscountMinor: unavailable,
      deliverySubtotalMinor: unavailable,
      deliveryFeeMinor: unavailable,
      deliveryDiscountMinor: unavailable,
      serviceFeeMinor: source === "ORDER_TOTAL_ONLY" ? null : 2_500,
      taxMinor: unavailable,
      totalMinor: 102_500,
    },
    payments: [],
    refunds: [],
    amendments: [],
    officialInvoice: { status: "NOT_READY", identifier: null },
  };
}

describe("TransactionSummary", () => {
  it("prominently labels the document and renders Core-provided service fees", () => {
    const html = renderToStaticMarkup(<TransactionSummary summary={summary("CHECKOUT_QUOTE")} />);
    expect(html.match(/NOT AN OFFICIAL BIR INVOICE/g)).toHaveLength(2);
    expect(html).toContain("FreshMarkets Service Fee");
    expect(html).toContain("₱25.00");
    expect(html).toContain("Print transaction summary");
    expect(html).not.toMatch(/TIN|official serial/i);
  });

  it("does not fabricate unavailable historical components", () => {
    const html = renderToStaticMarkup(<TransactionSummary summary={summary("ORDER_TOTAL_ONLY")} />);
    expect(html).toContain("Component totals are unavailable");
    expect(html).toContain("Unavailable");
  });
});
