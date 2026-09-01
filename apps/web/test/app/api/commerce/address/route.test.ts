import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  listCustomerAddresses: vi.fn(),
  createCustomerAddress: vi.fn(),
  updateCustomerAddress: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));

import { GET, PATCH, POST } from "@/app/api/commerce/address/route";

const components = {
  addressLine1: "Ayala Center Cebu",
  addressLine2: null,
  barangay: "Luz",
  city: "Cebu City",
  region: "Central Visayas",
  postalCode: "6000",
  countryCode: "PH",
};
const instructions = {
  buildingUnit: "Unit 4",
  landmark: "Main entrance",
  gateGuard: "Leave ID with guard",
  deliveryNote: "Call on arrival",
  recipientInstruction: "Ask for Ana",
};

function request(method: "POST" | "PATCH", body: unknown) {
  return new Request("https://freshmarkets.ph/api/commerce/address", {
    method,
    headers: {
      "content-type": "application/json",
      cookie: "freshmarkets.session=secret",
      origin: "https://freshmarkets.ph",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const method of Object.values(core)) method.mockReset();
});

describe("customer address route", () => {
  it("forwards browser session headers on authenticated address reads", async () => {
    core.listCustomerAddresses.mockResolvedValue({ ok: true, value: [], requestId: "read-1" });

    await GET(
      new Request("https://freshmarkets.ph/api/commerce/address", {
        headers: { cookie: "freshmarkets.session=secret" },
      }),
    );

    expect(core.listCustomerAddresses.mock.calls[0][0].headers.cookie).toBe(
      "freshmarkets.session=secret",
    );
  });

  it("forwards a structured confirmed address and session headers without raw JSON", async () => {
    core.createCustomerAddress.mockResolvedValue({
      ok: true,
      value: { id: "address-1" },
      requestId: "create-1",
    });
    const response = await POST(
      request("POST", {
        label: "Home",
        recipient: "Ana Santos",
        phone: "+639171234567",
        components,
        componentsSource: "FIRST_PARTY",
        latitude: 10.3173,
        longitude: 123.9058,
        confirmationSource: "USER_PIN",
        instructions,
        notes: "Weekday deliveries",
      }),
    );

    expect(response.status).toBe(200);
    expect(core.createCustomerAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Home",
        recipient: "Ana Santos",
        phone: "+639171234567",
        components,
        componentsSource: "FIRST_PARTY",
        latitude: 10.3173,
        longitude: 123.9058,
        confirmationSource: "USER_PIN",
        instructions,
        notes: "Weekday deliveries",
        headers: expect.objectContaining({
          cookie: "freshmarkets.session=secret",
          origin: "https://freshmarkets.ph",
        }),
      }),
    );
    expect(core.createCustomerAddress.mock.calls[0][0]).not.toHaveProperty("addressJson");
  });

  it("requires an expected version and forwards structured coordinate edits", async () => {
    core.updateCustomerAddress.mockResolvedValue({
      ok: true,
      value: { id: "address-1", version: 3 },
      requestId: "update-1",
    });
    const invalid = await PATCH(request("PATCH", { addressId: "address-1", label: "Work" }));
    expect(invalid.status).toBe(400);
    expect(core.updateCustomerAddress).not.toHaveBeenCalled();

    await PATCH(
      request("PATCH", {
        addressId: "address-1",
        expectedVersion: 2,
        components,
        componentsSource: "FIRST_PARTY",
        latitude: 10.3174,
        longitude: 123.9059,
        confirmationSource: "USER_PIN",
        instructions,
      }),
    );
    expect(core.updateCustomerAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        addressId: "address-1",
        expectedVersion: 2,
        componentsSource: "FIRST_PARTY",
        confirmationSource: "USER_PIN",
        headers: expect.objectContaining({ cookie: "freshmarkets.session=secret" }),
      }),
    );
  });

  it("accepts unchanged saved component provenance only on updates", async () => {
    core.updateCustomerAddress.mockResolvedValue({
      ok: true,
      value: { id: "address-1", version: 4 },
      requestId: "update-saved-1",
    });

    const response = await PATCH(
      request("PATCH", {
        addressId: "address-1",
        expectedVersion: 3,
        components,
        componentsSource: "SAVED_ADDRESS",
        latitude: 10.3173,
        longitude: 123.9058,
        confirmationSource: "USER_PIN",
        instructions,
      }),
    );

    expect(response.status).toBe(200);
    expect(core.updateCustomerAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        addressId: "address-1",
        componentsSource: "SAVED_ADDRESS",
      }),
    );
  });

  it("rejects temporary geocoder components without their final confirmed coordinate", async () => {
    const response = await PATCH(
      request("PATCH", {
        addressId: "address-1",
        expectedVersion: 3,
        components,
        componentsSource: "TEMPORARY_GEOCODER",
        instructions,
      }),
    );

    expect(response.status).toBe(400);
    expect(core.updateCustomerAddress).not.toHaveBeenCalled();
  });
});
