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
import type { OrderState, PaymentState, RefundState, SubscriptionState } from "./states";
import type { CustomerOrderView, ReceivingCommandResult } from "./index";

describe("closed lifecycle vocabularies", () => {
  it("keeps the canonical subscription states with CANCELED spelling and terminal states", () => {
    expect(subscriptionStates).toEqual([
      "PENDING",
      "TRIALING",
      "ACTIVE",
      "PAST_DUE",
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

  it("applies closed unions to DTO fixtures at compile time", () => {
    const eligibility: { status: SubscriptionState | null } = { status: "TRIALING" };
    const order: CustomerOrderView = {
      id: "order-1",
      status: "COMMITTED" as ImplementedOrder & CustomerOrderView["status"],
      deliveryDate: "2026-09-01T00:00:00.000Z",
      totalMinor: 19900,
      currency: "PHP",
      itemCount: 2,
    };
    void order;
    const receiving: ReceivingCommandResult = {
      receivingRecordId: "rec-1",
      status: "IN_PROGRESS" as ImplementedReceiving & ReceivingCommandResult["status"],
      acceptedBase: 4,
      rejectedBase: 0,
      remainingBase: 6,
      version: 2,
    };
    void receiving;
    void eligibility;
    const paymentFixture: PaymentState = "SUCCEEDED";
    const refundFixture: RefundState = "SUCCEEDED";
    const orderFixture: OrderState = "COMMITTED";
    void paymentFixture;
    void refundFixture;
    void orderFixture;
    expect(true).toBe(true);
  });
});

type ImplementedOrder = CustomerOrderView["status"];
type ImplementedReceiving = ReceivingCommandResult["status"];
