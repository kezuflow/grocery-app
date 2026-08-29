import { describe, expect, it } from "vitest";
import {
  orderIssueCategories,
  orderIssueStatuses,
  orderIssueActions,
  reconciliationCaseCategories,
  type AdminOrderSummary,
  type AdminOrderDetail,
  type AdminPaymentDetail,
  type AdminPaymentOverview,
  type AdminPaymentSummary,
  type AdminMembershipSummary,
  type AdminOrderIssueView,
} from "./admin-finance";

describe("finance contracts", () => {
  it("publishes the closed issue, reconciliation, and payment vocabularies", () => {
    expect(orderIssueCategories).toEqual([
      "MISSING_ITEM",
      "WRONG_ITEM",
      "DAMAGED",
      "QUALITY",
      "QUANTITY",
      "DELIVERY",
      "OTHER",
    ]);
    expect(orderIssueStatuses).toEqual([
      "SUBMITTED",
      "CLAIMED",
      "INVESTIGATING",
      "RESOLVED",
      "ESCALATED",
    ]);
    expect(orderIssueActions).toEqual(["CLAIM", "BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"]);
    expect(orderIssueActions).not.toContain("REOPEN");
    expect(reconciliationCaseCategories).toEqual([
      "UNMAPPED_PROVIDER_REFERENCE",
      "AMBIGUOUS_OUTCOME",
      "PROVIDER_TIMEOUT",
      "REACTION_FAILURE",
      "REFUND_UNRESOLVED",
    ]);
  });

  it("keeps finance payloads as purpose-built DTOs", () => {
    void ({
      orderId: "ord-1",
      customerEmail: "c@example.com",
      status: "COMMITTED",
      totalMinor: 50000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "PENDING",
      deliveryStatus: null,
      committedAt: "2026-08-20T00:00:00.000Z",
      version: 1,
    } satisfies AdminOrderSummary);
    void ({
      paymentIntentId: "pi-1",
      purpose: "GROCERY_CHECKOUT",
      customerEmail: "c@example.com",
      amountMinor: 50000,
      currency: "PHP",
      status: "SUCCEEDED",
      refundedMinor: 0,
      createdAt: "2026-08-20T00:00:00.000Z",
    } satisfies AdminPaymentSummary);
    void ({
      subscriptionId: "sub-1",
      customerEmail: "c@example.com",
      state: "ACTIVE",
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: null,
      version: 4,
    } satisfies AdminMembershipSummary);
    void ({
      issueId: "iss-1",
      orderId: "ord-1",
      category: "MISSING_ITEM",
      status: "SUBMITTED",
      details: "one onion missing",
      assignedStaffId: null,
      resolution: null,
      version: 1,
      createdAt: "2026-08-27T00:00:00.000Z",
    } satisfies AdminOrderIssueView);
  });

  it("publishes complete order and payment workspace projections without raw provider data", () => {
    const order = {
      orderId: "ord-1",
      customerEmail: "c@example.com",
      status: "COMMITTED",
      totalMinor: 50_000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "PICKING",
      deliveryStatus: "ASSIGNED",
      committedAt: "2026-08-20T00:00:00.000Z",
      version: 2,
      allowedActions: ["CANCEL"],
      financial: {
        subtotalMinor: 48_000,
        discountMinor: 1_000,
        deliveryFeeMinor: 3_000,
        totalMinor: 50_000,
        currency: "PHP",
        source: "CHECKOUT_QUOTE",
      },
      items: [
        {
          productName: "Carrots",
          variantName: "500 g bag",
          unit: "GRAM",
          quantity: 2,
          baseQuantity: 1_000,
          unitPriceMinor: 12_000,
          lineTotalMinor: 24_000,
        },
      ],
      payments: [
        {
          paymentIntentId: "pi-1",
          purpose: "GROCERY_CHECKOUT",
          status: "SUCCEEDED",
          amountMinor: 50_000,
          refundedMinor: 0,
          currency: "PHP",
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      amendments: [],
      fulfillment: {
        locationId: "loc-1",
        cycleId: "cycle-1",
        zoneId: "zone-1",
        fulfillmentMode: "SCHEDULED",
        cutoffAt: "2026-08-20T08:00:00.000Z",
        deliveryDate: "2026-08-21",
        promisedAt: "2026-08-21T04:00:00.000Z",
        sourcingModes: ["PLANNED"],
        status: "PICKING",
        version: 1,
        updatedAt: "2026-08-20T01:00:00.000Z",
      },
      delivery: {
        deliveryJobId: "delivery-1",
        status: "ASSIGNED",
        riderUserId: "rider-1",
        version: 1,
        deliveredAt: null,
        createdAt: "2026-08-20T01:00:00.000Z",
        updatedAt: "2026-08-20T01:00:00.000Z",
      },
      exceptions: [],
      timeline: [],
      recentAudit: [],
    } satisfies AdminOrderDetail;

    const payment = {
      paymentIntentId: "pi-1",
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_quote",
      subjectId: "quote-1",
      customerEmail: "c@example.com",
      amountMinor: 50_000,
      refundedMinor: 10_000,
      remainingRefundableMinor: 40_000,
      currency: "PHP",
      status: "PARTIALLY_REFUNDED",
      version: 3,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T01:00:00.000Z",
      allowedActions: ["REQUEST_REFUND"],
      attempts: [],
      refunds: [],
      events: [],
      reactions: [],
      reconciliationCases: [],
      recentAudit: [],
    } satisfies AdminPaymentDetail;

    void ({
      intentCounts: {
        total: 4,
        actionRequired: 1,
        processing: 1,
        succeeded: 2,
        failed: 0,
      },
      openReconciliationCount: 1,
      pendingRefundCount: 1,
      totalsByCurrency: [{ currency: "PHP", succeededMinor: 100_000, refundedMinor: 10_000 }],
      recentTransactions: [payment],
    } satisfies AdminPaymentOverview);

    expect(order.financial.source).toBe("CHECKOUT_QUOTE");
    expect(payment).not.toHaveProperty("providerReference");
    expect(payment).not.toHaveProperty("payloadHash");
  });
});
