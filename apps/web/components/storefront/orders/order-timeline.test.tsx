import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderTimeline } from "./order-timeline";

describe("OrderTimeline", () => {
  it("shows four fixed milestones with only achieved timestamps", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        progress={{
          steps: [
            { key: "PAYMENT", state: "COMPLETE", achievedAt: "2026-09-21T11:45:44.000Z" },
            { key: "PACKED", state: "CURRENT", achievedAt: null },
            { key: "OUT_FOR_DELIVERY", state: "UPCOMING", achievedAt: null },
            { key: "DELIVERED", state: "UPCOMING", achievedAt: null },
          ],
          detail: "Your order is being packed.",
        }}
      />,
    );
    expect(html.match(/data-timeline-marker/g)).toHaveLength(4);
    expect(html).toContain("Payment successful");
    expect(html).toContain("Packed");
    expect(html).toContain("Out for delivery");
    expect(html).toContain("Delivered");
    expect(html).toContain('data-progress-state="CURRENT"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("In progress");
    expect(html.match(/<time /g)).toHaveLength(1);
    expect(html).toContain("Your order is being packed.");
    expect(html).not.toContain("Order placed");
  });

  it("marks all completed stages and connectors green", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        progress={{
          steps: [
            { key: "PAYMENT", state: "COMPLETE", achievedAt: "2026-09-21T11:45:44.000Z" },
            { key: "PACKED", state: "COMPLETE", achievedAt: "2026-09-21T14:45:59.000Z" },
            { key: "OUT_FOR_DELIVERY", state: "COMPLETE", achievedAt: "2026-09-21T15:00:00.000Z" },
            { key: "DELIVERED", state: "COMPLETE", achievedAt: "2026-09-21T16:00:00.000Z" },
          ],
          detail: "Your order was delivered.",
        }}
      />,
    );
    expect(html.match(/data-progress-state="COMPLETE"/g)).toHaveLength(4);
    expect(html.match(/data-complete="true"/g)).toHaveLength(7);
    expect(html.match(/<time /g)).toHaveLength(4);
    expect(html).toContain("--fm-storefront-accent");
  });
});
