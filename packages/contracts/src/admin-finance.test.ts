import { describe, expect, it } from "vitest";
import {
  orderIssueCategories,
  orderIssueStatuses,
  orderIssueActions,
  reconciliationCaseCategories,
  type AdminOrderSummary,
  type AdminOrderDetail,
  type AdminPaymentDetail,
  type AdminPaymentSummary,
  type AdminMembershipSummary,
  type AdminOrderIssueView,
  type AdminOrderIssueSummary,
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
    expect(orderIssueActions).toEqual(["CLAIM", "RESOLVE"]);
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
      orderNumber: "FM-2026-000001",
      customerName: "Ana Santos",
      customerEmail: "c@example.com",
      fulfillmentMode: "SCHEDULED",
      status: "COMMITTED",
      totalMinor: 50000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "PENDING",
      deliveryStatus: null,
      deliveryDispatchStatus: null,
      deliveryProviderStatus: null,
      committedAt: "2026-08-20T00:00:00.000Z",
      version: 1,
    } satisfies AdminOrderSummary);
    void ({
      paymentIntentId: "pi-1",
      purpose: "GROCERY_CHECKOUT",
      customerName: "Customer",
      customerEmail: "c@example.com",
      orderId: "ord-1",
      orderNumber: "FM-2026-000001",
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
      allowedActions: ["CLAIM"],
      version: 1,
      createdAt: "2026-08-27T00:00:00.000Z",
    } satisfies AdminOrderIssueView);
    void ({
      issueId: "iss-1",
      orderId: "ord-1",
      orderNumber: "FM-2026-000001",
      customerPhone: null,
      customerName: "Ana Santos",
      customerEmail: "c@example.com",
      category: "MISSING_ITEM",
      status: "SUBMITTED",
      details: "one onion missing",
      assignedStaffId: null,
      assignedStaffName: null,
      resolution: null,
      allowedActions: ["CLAIM"],
      version: 1,
      createdAt: "2026-08-27T00:00:00.000Z",
    } satisfies AdminOrderIssueSummary);
  });

  it("publishes complete order and payment workspace projections without raw provider data", () => {
    const order = {
      orderId: "ord-1",
      orderNumber: "FM-2026-000001",
      customerName: "Ana Santos",
      customerEmail: "c@example.com",
      fulfillmentMode: "SCHEDULED",
      status: "COMMITTED",
      totalMinor: 50_000,
      currency: "PHP",
      paymentStatus: "SUCCEEDED",
      fulfillmentStatus: "PICKING",
      deliveryStatus: "ASSIGNED",
      deliveryDispatchStatus: "ACTIVE",
      deliveryProviderStatus: "PENDING_PICKUP",
      committedAt: "2026-08-20T00:00:00.000Z",
      version: 2,
      allowedActions: ["CANCEL"],
      customer: {
        name: "Ana Santos",
        email: "c@example.com",
        phone: "+639171234567",
        addressLines: ["Cebu City", "6000"],
      },
      financial: {
        subtotalMinor: 48_000,
        discountMinor: 1_000,
        deliveryFeeMinor: 3_000,
        serviceFeeMinor: 0,
        taxMinor: 0,
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
      customerName: "Customer",
      customerEmail: "c@example.com",
      orderId: "ord-1",
      orderNumber: "FM-2026-000001",
      amountMinor: 50_000,
      refundedMinor: 10_000,
      remainingRefundableMinor: 40_000,
      refundUnavailableReason: null,
      lookupRecovery: {
        version: 0,
        status: "NOT_STARTED",
        attempts: 0,
        nextCheckAt: null,
        lastErrorCode: null,
        canRecheck: false,
      },
      currency: "PHP",
      status: "PARTIALLY_REFUNDED",
      canonicalStatus: "PARTIALLY_REFUNDED",
      displayStatus: "PARTIALLY_REFUNDED",
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

    expect(order.financial.source).toBe("CHECKOUT_QUOTE");
    expect(payment).not.toHaveProperty("providerReference");
    expect(payment).not.toHaveProperty("payloadHash");
  });
});
