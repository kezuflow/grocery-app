import { describe, expect, it } from "vitest";
import type { CustomerOrderDetailView, ReorderResultView } from "./orders";

describe("customer order contracts", () => {
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
});
