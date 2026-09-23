import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderTimeline } from "./order-timeline";

describe("OrderTimeline", () => {
  it("renders semantic customer-safe entries", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        entries={[
          {
            eventId: "PAYMENT_STATUS:payment-1",
            type: "PAYMENT_STATUS",
            title: "Payment successful",
            description: "Your payment is now succeeded.",
            status: "SUCCEEDED",
            occurredAt: "2026-08-29T23:59:00.000Z",
          },
          {
            eventId: "ORDER_COMMITTED:order-1",
            type: "ORDER_COMMITTED",
            title: "Order placed",
            description: "Your payment was verified and your order was placed.",
            status: "COMMITTED",
            occurredAt: "2026-08-30T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain('aria-label="Order progress"');
    expect(html).not.toContain("overflow-x-auto");
    expect(html).toContain("bg-[var(--fm-storefront-accent)]");
    expect(html).toContain("text-[var(--fm-storefront-accent)]");
    expect(html).not.toContain("Your payment is now succeeded.");
    expect(html).toContain("Order placed");
    expect(html).toContain("Your payment was verified and your order was placed.");
    expect(html).toContain('dateTime="2026-08-30T00:00:00.000Z"');
  });

  it("shows recognizable icons in canonical progress order without changing the latest update", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        entries={[
          {
            eventId: "PAYMENT_STATUS:payment-1",
            type: "PAYMENT_STATUS",
            title: "Payment successful",
            description: "Your payment is now succeeded.",
            status: "SUCCEEDED",
            occurredAt: "2026-09-21T11:37:08.000Z",
          },
          {
            eventId: "DELIVERY_STATUS:delivery-1",
            type: "DELIVERY_STATUS",
            title: "Courier assigned",
            description: "Your delivery is now assigned.",
            status: "ASSIGNED",
            occurredAt: "2026-09-21T15:45:44.000Z",
          },
          {
            eventId: "ORDER_COMMITTED:order-1",
            type: "ORDER_COMMITTED",
            title: "Order placed",
            description: "Your payment was verified and your order was placed.",
            status: "COMMITTED",
            occurredAt: "2026-09-21T11:45:44.000Z",
          },
          {
            eventId: "FULFILLMENT_STATUS:order-1",
            type: "FULFILLMENT_STATUS",
            title: "Packing order",
            description: "Order preparation is now packing.",
            status: "PACKING",
            occurredAt: "2026-09-21T14:45:59.000Z",
          },
        ]}
      />,
    );

    expect(html.match(/data-timeline-marker/g)).toHaveLength(4);
    expect(html.indexOf("Payment successful")).toBeLessThan(html.indexOf("Order placed"));
    expect(html.indexOf("Order placed")).toBeLessThan(html.indexOf("Packing order"));
    expect(html.indexOf("Packing order")).toBeLessThan(html.indexOf("Courier assigned"));
    expect(html).toContain("Your delivery is now assigned.");
  });

  it("announces unavailable historical timelines", () => {
    const html = renderToStaticMarkup(<OrderTimeline entries={[]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("not available for this historical order");
  });
});
