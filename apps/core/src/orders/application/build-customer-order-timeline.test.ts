import { describe, expect, it } from "vitest";
import { buildCustomerOrderTimeline } from "./build-customer-order-timeline";

describe("buildCustomerOrderTimeline", () => {
  it("orders entries chronologically with a stable type and id tie-break", () => {
    const timeline = buildCustomerOrderTimeline([
      { type: "ISSUE_STATUS", id: "issue-b", status: "SUBMITTED", occurredAt: 300 },
      { type: "PAYMENT_STATUS", id: "payment-a", status: "SUCCEEDED", occurredAt: 200 },
      { type: "ORDER_COMMITTED", id: "order-a", status: "COMMITTED", occurredAt: 100 },
      { type: "AMENDMENT_STATUS", id: "amendment-a", status: "DRAFT", occurredAt: 300 },
      { type: "ISSUE_STATUS", id: "issue-a", status: "INVESTIGATING", occurredAt: 300 },
    ]);

    expect(timeline.map((entry) => entry.eventId)).toEqual([
      "ORDER_COMMITTED:order-a",
      "PAYMENT_STATUS:payment-a",
      "AMENDMENT_STATUS:amendment-a",
      "ISSUE_STATUS:issue-a",
      "ISSUE_STATUS:issue-b",
    ]);
  });

  it("uses controlled customer-safe copy rather than record details", () => {
    const [entry] = buildCustomerOrderTimeline([
      { type: "DELIVERY_STATUS", id: "delivery-a", status: "EN_ROUTE", occurredAt: 100 },
    ]);

    expect(entry).toEqual({
      eventId: "DELIVERY_STATUS:delivery-a",
      type: "DELIVERY_STATUS",
      title: "Delivery update",
      description: "Your delivery is now en route.",
      status: "EN_ROUTE",
      occurredAt: new Date(100).toISOString(),
    });
    expect(JSON.stringify(entry)).not.toMatch(/provider|rider|staff|payload|coordinate/i);
  });
});
