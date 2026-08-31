import { describe, expect, it } from "vitest";
import {
  customerOrderIssueCategories,
  type CustomerOrderDetailView,
  type CustomerOrderIssueView,
  type CancelCustomerOrderRequest,
  type OrderCancellationView,
  type ReorderResultView,
} from "./orders";

describe("customer order contracts", () => {
  it("publishes a customer-only cancellation command and provider-neutral refund set", () => {
    const request = {
      requestId: "request-1",
      headers: {},
      orderId: "order-1",
      expectedVersion: 3,
      reason: "Plans changed",
      idempotencyKey: "cancel-order-1-v3",
    } satisfies CancelCustomerOrderRequest;
    const cancellation = {
      cancellationId: "cancellation-1",
      status: "REFUNDS_PROCESSING",
      requiredRefundMinor: 97_500,
      retainedServiceFeeMinor: 2_500,
      currency: "PHP",
      refunds: [
        {
          paymentId: "payment-1",
          refundId: "refund-1",
          amountMinor: 97_500,
          status: "PROCESSING",
        },
      ],
    } satisfies OrderCancellationView;

    expect(request).not.toHaveProperty("actor");
    expect(request).not.toHaveProperty("cause");
    expect(cancellation.refunds[0]).not.toHaveProperty("provider");
  });
  it("contains purpose-built customer fields without provider, staff, audit, or routing leakage", () => {
    type Keys = keyof CustomerOrderDetailView;
    const forbidden: readonly string[] = [
      "provider",
      "providerReference",
      "providerEventId",
      "payload",
      "payloadHash",
      "reconciliation",
      "audit",
      "staffIdentity",
      "internalNotes",
      "inventory",
      "procurement",
      "riderCoordinates",
      "locationId",
    ];
    const keys: readonly Keys[] = [
      "orderId",
      "orderNumber",
      "status",
      "version",
      "committedAt",
      "financial",
      "items",
      "fulfillment",
      "payments",
      "refunds",
      "amendments",
      "issues",
      "invoice",
      "timeline",
      "cancellation",
      "actions",
    ];

    expect(forbidden.some((field) => (keys as readonly string[]).includes(field))).toBe(false);
  });

  it("models unavailable historical components as nullable instead of fabricated zeroes", () => {
    const financial: CustomerOrderDetailView["financial"] = {
      source: "ORDER_TOTAL_ONLY",
      currency: "PHP",
      merchandiseSubtotalMinor: null,
      itemDiscountMinor: null,
      orderDiscountMinor: null,
      deliverySubtotalMinor: null,
      deliveryFeeMinor: null,
      deliveryDiscountMinor: null,
      serviceFeeMinor: null,
      taxMinor: null,
      totalMinor: 10_000,
    };
    expect(financial.merchandiseSubtotalMinor).toBeNull();
  });

  it("returns current-cart additions and controlled skip reasons without historical authority", () => {
    const result = {
      outcome: "PARTIAL",
      cartId: "cart-1",
      newCartVersion: 4,
      addedLines: [
        {
          skuId: "sku-1",
          name: "Onion",
          quantityAdded: 2,
          newQuantity: 3,
          currentUnitPriceMinor: 12_900,
          currency: "PHP",
        },
      ],
      skippedLines: [
        { skuId: "sku-2", productName: "Old item", quantity: 1, reason: "SKU_INACTIVE" },
      ],
      requiresFulfillmentReview: true,
      requiresAddressReview: true,
    } satisfies ReorderResultView;

    expect(result).not.toHaveProperty("historicalPriceMinor");
    expect(result).not.toHaveProperty("promotionCodes");
    expect(result).not.toHaveProperty("cycleId");
    expect(result).not.toHaveProperty("addressId");
  });

  it("closes customer issue categories and omits assignment, refund, and Admin action authority", () => {
    expect(customerOrderIssueCategories).toEqual([
      "MISSING_ITEM",
      "WRONG_ITEM",
      "DAMAGED_ITEM",
      "POOR_QUALITY",
      "QUANTITY_DISCREPANCY",
      "DELIVERY_ISSUE",
      "OTHER",
    ]);
    const issue = {
      issueId: "issue-1",
      orderId: "order-1",
      category: "POOR_QUALITY",
      status: "IN_REVIEW",
      description: "Produce arrived bruised",
      affectedOrderItemIds: ["item-1"],
      resolutionMessage: null,
      terminal: false,
      version: 2,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:01:00.000Z",
    } satisfies CustomerOrderIssueView;
    expect(issue).not.toHaveProperty("assignedStaffId");
    expect(issue).not.toHaveProperty("internalNotes");
    expect(issue).not.toHaveProperty("refundAction");
    expect(issue).not.toHaveProperty("adminActions");
  });
});
