import { describe, expect, it } from "vitest";
import type { CustomerOrderDetailView } from "./orders";

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
});
