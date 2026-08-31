import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminPaymentOverview } from "@freshmarkets/contracts";
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/payments" }));
import { PaymentOverviewView } from "./payment-overview-view";

describe("PaymentOverviewView", () => {
  it("renders only canonical payment, refund, and reconciliation values", () => {
    const overview: AdminPaymentOverview = {
      intentCounts: { total: 7, actionRequired: 1, processing: 2, succeeded: 3, failed: 1 },
      openReconciliationCount: 2,
      pendingRefundCount: 1,
      totalsByCurrency: [{ currency: "PHP", succeededMinor: 12_500, refundedMinor: 2_500 }],
      recentTransactions: [],
    };
    const html = renderToStaticMarkup(<PaymentOverviewView overview={overview} />);
    expect(html).toContain("Payment workload");
    expect(html).toContain("Open reconciliation");
    expect(html).toContain("₱125.00");
    expect(html).toContain("₱25.00");
    expect(html).not.toContain("Growth");
  });
});
