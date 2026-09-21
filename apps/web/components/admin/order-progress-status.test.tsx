import type { AdminOrderSummary } from "@freshmarkets/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderProgressStatus, orderProgressFacts } from "./order-progress-status";

function order(overrides: Partial<AdminOrderSummary> = {}): AdminOrderSummary {
  return {
    orderId: "order-1",
    orderNumber: "FM-1",
    customerName: "Customer",
    customerEmail: "customer@example.test",
    fulfillmentMode: "INSTANT",
    status: "COMMITTED",
    totalMinor: 10_000,
    currency: "PHP",
    paymentStatus: "SUCCEEDED",
    fulfillmentStatus: "NOT_STARTED",
    deliveryStatus: "UNASSIGNED",
    deliveryDispatchStatus: null,
    deliveryProviderStatus: null,
    committedAt: "2026-09-21T08:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("OrderProgressStatus", () => {
  it("shows commitment instead of the internal unassigned delivery placeholder", () => {
    const html = renderToStaticMarkup(<OrderProgressStatus order={order()} />);

    expect(html).toContain("Committed");
    expect(html).not.toContain("Unassigned");
  });

  it("shows overlapping preparation and courier progress", () => {
    const facts = orderProgressFacts(
      order({
        status: "FULFILLMENT_PENDING",
        fulfillmentStatus: "PACKING",
        deliveryDispatchStatus: "ACTIVE",
        deliveryProviderStatus: "ALLOCATING",
      }),
    );

    expect(facts.map((fact) => fact.label)).toEqual(["Packing", "Finding rider"]);
  });

  it("uses the customer-meaningful packed and assigned labels", () => {
    const facts = orderProgressFacts(
      order({
        status: "FULFILLMENT_READY",
        fulfillmentStatus: "PACKED",
        deliveryStatus: "ASSIGNED",
        deliveryDispatchStatus: "ACTIVE",
        deliveryProviderStatus: "PENDING_PICKUP",
      }),
    );

    expect(facts.map((fact) => fact.label)).toEqual(["Ready for pickup", "Rider assigned"]);
  });

  it("lets terminal order outcomes override stale operational records", () => {
    const facts = orderProgressFacts(
      order({
        status: "CANCELED",
        fulfillmentStatus: "PACKING",
        deliveryStatus: "UNASSIGNED",
        deliveryDispatchStatus: "ACTIVE",
        deliveryProviderStatus: "ALLOCATING",
      }),
    );

    expect(facts.map((fact) => fact.label)).toEqual(["Canceled"]);
  });

  it("collapses handed-off delivery to its current out-for-delivery stage", () => {
    const facts = orderProgressFacts(
      order({
        status: "OUT_FOR_DELIVERY",
        fulfillmentStatus: "HANDED_OFF",
        deliveryStatus: "EN_ROUTE",
        deliveryDispatchStatus: "ACTIVE",
        deliveryProviderStatus: "IN_DELIVERY",
      }),
    );

    expect(facts.map((fact) => fact.label)).toEqual(["Out for delivery"]);
  });
});
