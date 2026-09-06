import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FulfillmentOptionPicker } from "./fulfillment-option-picker";
describe("FulfillmentOptionPicker", () => {
  it("presents modes and controlled unavailable reasons without a hub", () => {
    const html = renderToStaticMarkup(
      <FulfillmentOptionPicker
        disabled={false}
        onSelect={() => undefined}
        options={[
          {
            optionId: "opaque",
            mode: "INSTANT",
            eligible: true,
            unavailableReason: null,
            deliveryPartner: {
              code: "lalamove",
              displayName: "Lalamove",
              serviceType: "MOTORCYCLE",
              serviceLabel: "Motorcycle",
            },
            promisedAt: "2026-09-01T00:00:00Z",
            deliveryWindow: null,
            feePreview: {
              subtotalMinor: 5000,
              discountMinor: 0,
              totalMinor: 5000,
              currency: "PHP",
            },
            cycleId: null,
            cutoffAt: null,
            provisional: true,
          },
          {
            optionId: "opaque-2",
            mode: "SCHEDULED",
            eligible: false,
            unavailableReason: "CYCLE_UNAVAILABLE",
            promisedAt: null,
            deliveryWindow: null,
            feePreview: null,
            cycleId: null,
            cutoffAt: null,
            provisional: true,
          },
        ]}
      />,
    );
    expect(html).toContain("Lalamove");
    expect(html).toContain("Motorcycle");
    expect(html).toContain("Scheduled delivery");
    expect(html).toContain("cycle unavailable");
    expect(html).not.toMatch(/hub|location-cebu/i);
  });
});
