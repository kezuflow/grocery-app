import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CustomerOrderDetailView } from "@freshmarkets/contracts";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ "order-id": "order-1" }) }));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => children,
}));

import { OrderDetailContent } from "@/app/orders/[order-id]/page";

function detail(source: CustomerOrderDetailView["financial"]["source"]): CustomerOrderDetailView {
  const components = source === "ORDER_TOTAL_ONLY" ? null : 0;
  return {
    orderId: "order-1",
    orderNumber: "FM-2026-ORDER1",
    status: "COMMITTED",
    version: 2,
    committedAt: "2026-08-30T00:00:00.000Z",
    financial: {
      source,
      currency: "PHP",
      merchandiseSubtotalMinor: source === "ORDER_TOTAL_ONLY" ? null : 30_000,
      itemDiscountMinor: components,
      orderDiscountMinor: source === "ORDER_TOTAL_ONLY" ? null : 3_000,
      deliverySubtotalMinor: source === "ORDER_TOTAL_ONLY" ? null : 2_000,
      deliveryFeeMinor: source === "ORDER_TOTAL_ONLY" ? null : 1_500,
      deliveryDiscountMinor: source === "ORDER_TOTAL_ONLY" ? null : 500,
      serviceFeeMinor: components,
      taxMinor: components,
      totalMinor: 28_500,
    },
    items: [
      {
        orderItemId: "item-1",
        skuId: "sku-1",
        productName: "Red onion",
        variantName: "500 g",
        unit: "pack",
        quantity: 2,
        baseQuantity: 1000,
        unitPriceMinor: 15_000,
        lineTotalMinor: 30_000,
      },
    ],
    fulfillment: {
      mode: "SCHEDULED",
      status: "PICKING",
      deliveryStatus: "UNASSIGNED",
      cycleId: "cycle-1",
      deliveryDate: "2026-09-05T00:00:00.000Z",
      promisedAt: null,
      address: {
        label: "Home",
        recipient: "Ana",
        phone: "+63917",
        addressLine1: "Ayala Cebu",
        addressLine2: null,
        barangay: "Luz",
        city: "Cebu City",
        region: "Central Visayas",
        postalCode: "6000",
        countryCode: "PH",
        deliveryNote: "Call",
      },
    },
    payments: [
      {
        paymentId: "payment-1",
        purpose: "GROCERY_CHECKOUT",
        status: "SUCCEEDED",
        amountMinor: 28_500,
        currency: "PHP",
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:01.000Z",
      },
    ],
    refunds: [],
    amendments: [],
    issues: [
      {
        issueId: "issue-1",
        orderId: "order-1",
        category: "POOR_QUALITY",
        status: "IN_REVIEW",
        description: "Bruised",
        affectedOrderItemIds: ["item-1"],
        resolutionMessage: null,
        terminal: false,
        version: 1,
        createdAt: "2026-08-30T00:01:00.000Z",
        updatedAt: "2026-08-30T00:02:00.000Z",
      },
    ],
    invoice: { status: "NOT_AVAILABLE", invoiceIdentifier: null, issuedAt: null },
    timeline: [
      {
        eventId: "ORDER_COMMITTED:order-1",
        type: "ORDER_COMMITTED",
        title: "Order confirmed",
        description: "We confirmed your order after payment was verified.",
        status: "COMMITTED",
        occurredAt: "2026-08-30T00:00:00.000Z",
      },
    ],
    cancellation: {
      status: null,
      requiredRefundMinor: 28_500,
      retainedServiceFeeMinor: 0,
      currency: "PHP",
    },
    actions: [
      { action: "SUBMIT_ISSUE", available: true, disabledReason: null },
      { action: "VIEW_TRANSACTION_SUMMARY", available: true, disabledReason: null },
      {
        action: "CANCEL",
        available: true,
        disabledReason: null,
      },
    ],
  };
}

describe("customer order detail", () => {
  it("renders immutable items, financials, fulfillment, issues, invoice state, timeline, and Core actions", () => {
    const html = renderToStaticMarkup(<OrderDetailContent order={detail("CHECKOUT_QUOTE")} />);
    expect(html).toContain("FM-2026-ORDER1");
    expect(html).toContain("Red onion");
    expect(html).toContain("Merchandise subtotal");
    expect(html).toContain("Ayala Cebu");
    expect(html).toContain("Bruised");
    expect(html).toContain("invoice is not yet available");
    expect(html).toContain("Order confirmed");
    expect(html).toContain("Refund if canceled now");
    expect(html).toContain("₱285.00");
    expect(html).toContain("View transaction summary");
  });

  it("states when historical monetary components are unavailable", () => {
    const html = renderToStaticMarkup(<OrderDetailContent order={detail("ORDER_TOTAL_ONLY")} />);
    expect(html).toContain("component breakdown is unavailable");
    expect(html).toContain("Unavailable");
    expect(html).toContain("₱285.00");
  });
});
