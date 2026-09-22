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
            title: "Payment update",
            description: "Your payment is now succeeded.",
            status: "SUCCEEDED",
            occurredAt: "2026-08-29T23:59:00.000Z",
          },
          {
            eventId: "ORDER_COMMITTED:order-1",
            type: "ORDER_COMMITTED",
            title: "Order confirmed",
            description: "We confirmed your order after payment was verified.",
            status: "COMMITTED",
            occurredAt: "2026-08-30T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain('aria-label="Order progress"');
    expect(html).not.toContain("overflow-x-auto");
    expect(html).toContain("bg-[var(--fm-success)]");
    expect(html).toContain("text-[var(--fm-success)]");
    expect(html).not.toContain("Your payment is now succeeded.");
    expect(html).toContain("Order confirmed");
    expect(html).toContain("We confirmed your order after payment was verified.");
    expect(html).toContain('dateTime="2026-08-30T00:00:00.000Z"');
  });

  it("shows recognizable icons in canonical progress order without changing the latest update", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        entries={[
          {
            eventId: "PAYMENT_STATUS:payment-1",
            type: "PAYMENT_STATUS",
            title: "Payment update",
            description: "Your payment is now succeeded.",
            status: "SUCCEEDED",
            occurredAt: "2026-09-21T11:37:08.000Z",
          },
          {
            eventId: "DELIVERY_STATUS:delivery-1",
            type: "DELIVERY_STATUS",
            title: "Delivery update",
            description: "Your delivery is now unassigned.",
            status: "UNASSIGNED",
            occurredAt: "2026-09-21T11:45:44.000Z",
          },
          {
            eventId: "ORDER_COMMITTED:order-1",
            type: "ORDER_COMMITTED",
            title: "Order confirmed",
            description: "We confirmed your order after payment was verified.",
            status: "COMMITTED",
            occurredAt: "2026-09-21T11:45:44.000Z",
          },
          {
            eventId: "FULFILLMENT_STATUS:order-1",
            type: "FULFILLMENT_STATUS",
            title: "Order preparation update",
            description: "Order preparation is now packing.",
            status: "PACKING",
            occurredAt: "2026-09-21T14:45:59.000Z",
          },
        ]}
      />,
    );

    expect(html.match(/data-timeline-marker/g)).toHaveLength(4);
    expect(html.indexOf("Payment update")).toBeLessThan(html.indexOf("Order confirmed"));
    expect(html.indexOf("Order confirmed")).toBeLessThan(html.indexOf("Order preparation update"));
    expect(html.indexOf("Order preparation update")).toBeLessThan(html.indexOf("Delivery update"));
    expect(html).toContain("Order preparation is now packing.");
  });

  it("announces unavailable historical timelines", () => {
    const html = renderToStaticMarkup(<OrderTimeline entries={[]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("not available for this historical order");
  });
});
