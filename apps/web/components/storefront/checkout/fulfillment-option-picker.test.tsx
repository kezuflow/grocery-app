import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FulfillmentOptionPicker } from "./fulfillment-option-picker";
describe("FulfillmentOptionPicker", () => {
  it("presents delivery promises without internal location or window labels", () => {
    const html = renderToStaticMarkup(
      <FulfillmentOptionPicker
        disabled={false}
        selectedOptionId="opaque"
        loadingOptionId="opaque-2"
        quotedFee={{ optionId: "opaque", amountMinor: 5000, currency: "PHP" }}
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
            eligible: true,
            unavailableReason: null,
            promisedAt: null,
            deliveryWindow: {
              windowId: "internal-window",
              name: "Internal window name",
              startsAt: "2026-09-08T02:00:00Z",
              endsAt: "2026-09-08T04:00:00Z",
            },
            feePreview: {
              subtotalMinor: 5000,
              discountMinor: 0,
              totalMinor: 5000,
              currency: "PHP",
            },
            cycleId: "scheduled-cycle",
            cutoffAt: "2026-09-07T00:00:00Z",
            provisional: true,
          },
        ]}
      />,
    );
    expect(html).toContain("Lalamove");
    expect(html).toContain("Motorcycle");
    expect(html).toContain("Scheduled delivery");
    expect(html).toContain("₱50.00");
    expect(html).toContain("Checking fee…");
    expect(html).not.toContain("Calculated on review");
    expect(html).toContain("9/8/2026");
    expect(html).not.toContain("Internal window name");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/hub|location-cebu/i);
    expect(html).toContain("divide-y");
    expect(html).not.toContain("fm-shadow-card");
    expect(html).not.toContain("fm-radius-surface");
    expect(html).not.toContain("fm-surface-soft");
  });
});
