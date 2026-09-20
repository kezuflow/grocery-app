// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CustomerAddressView } from "@freshmarkets/contracts";
import { AddressList } from "./address-list";

const baseAddress: CustomerAddressView = {
  id: "address-1",
  label: "Home",
  recipient: "Ana Santos",
  phone: "+639171234567",
  components: {
    addressLine1: "Ayala Center Cebu",
    addressLine2: null,
    barangay: "Luz",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
  },
  confirmationSource: "USER_PIN",
  confirmedAt: "2026-08-30T00:00:00.000Z",
  instructions: {
    deliveryInstructions: "Main entrance",
  },
  latitude: 10.3173,
  longitude: 123.9058,
  serviceable: true,
  serviceabilityReason: null,
  serviceAreaCode: "CEBU_CITY",
  deliveryZoneCode: "CEBU_CITY_CORE",
  resolutionVersion: 1,
  status: "active",
  version: 2,
};

describe("AddressList", () => {
  it("keeps confirmed addresses selectable until the courier check runs at checkout", () => {
    const markup = renderToStaticMarkup(
      <AddressList
        addresses={[
          baseAddress,
          {
            ...baseAddress,
            id: "address-2",
            label: "Parents",
            serviceable: false,
            serviceabilityReason: "OUTSIDE_SERVICE_AREA",
          },
        ]}
        selectedAddressId="address-1"
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
      />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Saved delivery addresses"');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain("Home");
    expect(markup).toContain("Ayala Center Cebu");
    expect(markup).toContain("Courier checked at checkout");
    expect(markup).toContain("Edit Home address");
    expect(markup).toContain("Edit Parents address");
    expect(markup).not.toMatch(/address-2[\s\S]*disabled/);
  });

  it("announces an empty address book with a useful next action", () => {
    const markup = renderToStaticMarkup(
      <AddressList addresses={[]} onSelect={vi.fn()} onCorrect={vi.fn()} />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No saved delivery addresses yet");
  });

  it("supports a flat checkout presentation without card surfaces", () => {
    const markup = renderToStaticMarkup(
      <AddressList
        addresses={[baseAddress]}
        selectedAddressId="address-1"
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
        variant="flat"
      />,
    );

    expect(markup).not.toContain("fm-shadow-card");
    expect(markup).not.toContain("bg-[var(--fm-surface-soft)]");
    expect(markup).toContain("Edit address");
  });

  it("keeps boxed checkout addresses in one horizontally scrollable row", () => {
    const markup = renderToStaticMarkup(
      <AddressList
        addresses={[baseAddress, { ...baseAddress, id: "address-2", label: "Parents" }]}
        selectedAddressId="address-1"
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
        variant="row"
      />,
    );

    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("snap-x");
    expect(markup).toContain("shrink-0");
    expect(markup).toContain("rounded-[var(--fm-radius-surface)]");
    expect(markup).not.toContain("divide-y");
  });
});
