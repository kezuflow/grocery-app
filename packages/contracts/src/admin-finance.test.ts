import { describe, expect, it } from "vitest";
import {
  orderIssueCategories,
  orderIssueStatuses,
  orderIssueActions,
  reconciliationCaseCategories,
  type AdminOrderSummary,
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
    expect(orderIssueActions).toEqual([
      "CLAIM",
      "BEGIN_INVESTIGATION",
      "RESOLVE",
      "ESCALATE",
      "REOPEN",
    ]);
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
});
