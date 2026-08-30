import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderTimeline } from "./order-timeline";

describe("OrderTimeline", () => {
  it("renders semantic chronological customer-safe entries", () => {
    const html = renderToStaticMarkup(
      <OrderTimeline
        entries={[
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
    expect(html).toContain("Order confirmed");
    expect(html).toContain('dateTime="2026-08-30T00:00:00.000Z"');
  });

  it("announces unavailable historical timelines", () => {
    const html = renderToStaticMarkup(<OrderTimeline entries={[]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("not available for this historical order");
  });
});
