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
  it("shows the authenticated customer claim action as processing without exposing it after success", () => {
    const value = summary("CHECKOUT_QUOTE");
    value.refunds = [
      {
        refundId: "refund-fixture",
        amountMinor: 53500,
        currency: "PHP",
        status: "PROCESSING",
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
        claimAction: {
          url: "https://transfer.paymongo.com/fixture-claim",
          expiresAt: "2026-10-08T00:00:00Z",
        },
      },
    ];
    const html = renderToStaticMarkup(<TransactionSummary summary={value} />);
    expect(html).toContain("Claim refund");
    expect(html).toContain("Your refund remains processing");
    expect(html).toContain('referrerPolicy="no-referrer"');
    value.refunds = [{ ...value.refunds[0], status: "SUCCEEDED" }];
    expect(renderToStaticMarkup(<TransactionSummary summary={value} />)).not.toContain(
      "fixture-claim",
    );
  });
  it("prominently labels the document and renders historical fee evidence", () => {
    const html = renderToStaticMarkup(<TransactionSummary summary={summary("CHECKOUT_QUOTE")} />);
    expect(html.match(/NOT AN OFFICIAL BIR INVOICE/g)).toHaveLength(2);
    expect(html).toContain("Historical FreshMarkets fee");
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
