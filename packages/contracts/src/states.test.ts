import { describe, expect, it } from "vitest";
import { appErrorCodes, type AppErrorCode } from "./common";
import {
  customerAddressStatuses,
  deliveryCycleStates,
  implementedOrderStates,
  orderStates,
  paymentStates,
  receivingRecordStates,
  refundStates,
  subscriptionStates,
} from "./states";

describe("closed lifecycle vocabularies", () => {
  it("keeps the canonical subscription states with CANCELED spelling and terminal states", () => {
    expect(subscriptionStates).toEqual([
      "PENDING",
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
      "UNPAID",
      "PAUSED",
      "CANCELED",
      "EXPIRED",
    ]);
    expect(subscriptionStates).not.toContain("CANCELLED");
  });

  it("derives the payment states from the canonical machine", () => {
    expect(paymentStates).toEqual([
      "INITIATED",
      "REQUIRES_ACTION",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "EXPIRED",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
    ]);
  });

  it("derives the refund states from the canonical machine", () => {
    expect(refundStates).toEqual([
      "REQUESTED",
      "APPROVED",
      "PROCESSING",
      "SUCCEEDED",
      "REJECTED",
      "FAILED",
      "ESCALATED",
    ]);
  });

  it("derives the canonical order lifecycle without terminal exits", () => {
    expect(orderStates).toContain("PENDING_PAYMENT");
    expect(orderStates).toContain("CANCELLATION_REQUESTED");
    expect(orderStates).not.toContain("CANCELLED");
  });

  it("closes every remaining implemented vocabulary", () => {
    expect(implementedOrderStates).not.toContain("CANCELLED");
    expect(deliveryCycleStates).toContain("OPEN");
    expect(receivingRecordStates).toContain("IN_PROGRESS");
    expect(customerAddressStatuses).toEqual(["active", "disabled"]);
    for (const code of [
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "FINANCIAL_OPERATION_REQUIRES_REVIEW",
      "ROUTE_DISTANCE_UNAVAILABLE",
      "DELIVERY_FEE_CONFIGURATION_MISSING",
    ] satisfies readonly AppErrorCode[]) {
      expect(appErrorCodes).toContain(code);
    }
  });
});
