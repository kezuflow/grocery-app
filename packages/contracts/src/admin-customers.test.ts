import { describe, expect, it } from "vitest";
import {
  customerClosureRequestTypes,
  privacyRequestStatuses,
  privacyRequestActions,
  type AdminCustomerDetail,
  type AdminCustomerSummary,
  type PrivacyRequestView,
} from "./admin-customers";

describe("customer crm contracts", () => {
  it("publishes the closed closure, privacy status, and action vocabularies", () => {
    expect(customerClosureRequestTypes).toEqual(["ACCESS", "CORRECTION", "CLOSURE", "ANONYMIZATION"]);
    expect(privacyRequestStatuses).toEqual([
      "SUBMITTED",
      "VERIFYING",
      "APPROVED",
      "REJECTED",
      "PROCESSING",
      "COMPLETED",
      "ESCALATED",
    ]);
    expect(privacyRequestActions).toEqual([
      "VERIFY",
      "APPROVE",
      "REJECT",
      "BEGIN_PROCESSING",
      "COMPLETE",
      "ESCALATE",
    ]);
  });

  it("keeps customer and privacy payloads as purpose-built DTOs", () => {
    void ({
      customerId: "cust-1",
      authUserId: "auth-1",
      email: "customer@example.com",
      phone: null,
      accessStatus: "active",
      subscriptionState: "ACTIVE",
      orderCount: 3,
      lastOrderAt: "2026-08-20T00:00:00.000Z",
      version: 2,
      createdAt: "2026-01-15T00:00:00.000Z",
      recentAudit: [],
    } satisfies AdminCustomerDetail);
    void ({
      customerId: "cust-1",
      authUserId: "auth-1",
      email: "customer@example.com",
      phone: null,
      accessStatus: "active",
      subscriptionState: null,
      orderCount: 0,
      lastOrderAt: null,
      version: 1,
      createdAt: "2026-01-15T00:00:00.000Z",
    } satisfies AdminCustomerSummary);
    void ({
      privacyRequestId: "pr-1",
      customerId: "cust-1",
      requestType: "CLOSURE",
      status: "SUBMITTED",
      requestedAt: "2026-08-27T00:00:00.000Z",
      verifiedAt: null,
      resolvedAt: null,
      assignedStaffId: null,
      reason: "customer request",
      resolution: null,
      version: 1,
    } satisfies PrivacyRequestView);
  });
});
