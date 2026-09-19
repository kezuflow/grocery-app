import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FulfillmentOptionPicker } from "./fulfillment-option-picker";
describe("FulfillmentOptionPicker", () => {
  it("presents compact branded Instant courier choices", () => {
    const html = renderToStaticMarkup(
      <FulfillmentOptionPicker
        disabled={false}
        selectedOptionId="opaque"
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
            mode: "INSTANT",
            eligible: false,
            unavailableReason: "DELIVERY_PARTNER_UNAVAILABLE",
            deliveryPartner: {
              code: "grab-express",
              displayName: "GrabExpress",
              serviceType: "INSTANT",
              serviceLabel: "Bike",
            },
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
    expect(html).toContain("GrabExpress");
    expect(html).toContain('data-provider-icon="lalamove"');
    expect(html).toContain('data-provider-icon="grab-express"');
    expect(html).toContain("₱50.00");
    expect(html).toContain("delivery partner unavailable");
    expect(html).not.toContain("Calculated on review");
    expect(html).not.toContain("Internal window name");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/hub|location-cebu/i);
    expect(html).toContain("divide-y");
    expect(html).not.toContain("fm-shadow-card");
    expect(html).not.toContain("fm-radius-surface");
    expect(html).not.toContain("fm-surface-soft");
  });
});
