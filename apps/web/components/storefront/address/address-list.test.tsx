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
    buildingUnit: null,
    landmark: "Main entrance",
    gateGuard: null,
    deliveryNote: null,
    recipientInstruction: null,
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
  it("renders serviceable addresses as labelled radio choices and unavailable addresses with correction", () => {
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
    expect(markup).toContain("Delivery unavailable");
    expect(markup).toContain("Edit Home address");
    expect(markup).toContain("Correct Parents address");
    expect(markup).toMatch(/address-2[\s\S]*disabled/);
  });

  it("announces an empty address book with a useful next action", () => {
    const markup = renderToStaticMarkup(
      <AddressList addresses={[]} onSelect={vi.fn()} onCorrect={vi.fn()} />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No saved delivery addresses yet");
  });
});
