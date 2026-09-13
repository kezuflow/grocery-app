// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { LocationDeliveryProfileView } from "@freshmarkets/contracts";
import { LocationDeliveryProfilePanel } from "./location-delivery-profile-panel";

vi.mock("../../../app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: {
      phase: "ready",
      selectedScope: { kind: "LOCATION", locationId: "different-location" },
      context: { capabilities: ["delivery.manage"] },
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const view: LocationDeliveryProfileView = {
  locationId: "location-cebu-central",
  locationName: "Central Cebu",
  coordinate: { latitude: 10.3, longitude: 123.9 },
  profile: {
    senderName: "Test store",
    phoneE164: "+639171234567",
    email: null,
    formattedAddress: "Test street, Cebu",
    addressLine1: "Test street",
    addressLine2: null,
    barangay: null,
    city: "Cebu",
    region: null,
    postalCode: null,
    countryCode: "PH",
    pickupInstructions: null,
    version: 1,
  },
};
const response = () => Response.json({ ok: true, requestId: "test", value: view });
const fetchMock = vi.fn<typeof fetch>();
const savedLocation = {
  locationId: view.locationId,
  marketId: "market",
  marketName: "Cebu",
  currency: "PHP",
  timezone: "Asia/Manila",
  code: "central",
  name: "Central Cebu",
  purpose: "CUSTOMER_FULFILLMENT",
  status: "active",
  version: 8,
  addressProviderDerived: false,
  latitude: 10.3,
  longitude: 123.9,
  capabilities: ["PICKING", "PACKING", "DISPATCH"],
  address: {
    addressLine1: "Saved entrance",
    addressLine2: null,
    barangay: null,
    city: "Cebu",
    region: "Cebu",
    postalCode: null,
    countryCode: "PH",
  },
};
let host: HTMLDivElement;
let root: Root;
function button(name: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset();
  vi.mocked(toast.success).mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <LocationDeliveryProfilePanel locationId={view.locationId} fetchImpl={fetchMock} />,
    ),
  );
}

it("reads and saves the opened location regardless of the header scope, without erasing confirmation", async () => {
  fetchMock.mockImplementation(async () => response());
  await render();
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/admin/delivery-location-profile?locationId=location-cebu-central",
  );
  await act(async () => button("Update pickup profile").click());
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).locationId).toBe(view.locationId);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(toast.success).toHaveBeenCalledExactlyOnceWith("Courier pickup details saved", {
    description: undefined,
  });
  expect(host.textContent).toContain("Central Cebu courier pickup");
});

it("keeps draft fields and request identity after a lost save response", async () => {
  fetchMock
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValueOnce(response());
  await render();
  await act(async () => button("Update pickup profile").click());
  expect(host.textContent).toContain("Save not confirmed");
  expect(host.querySelector<HTMLInputElement>('[name="senderName"]')?.disabled).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => button("Retry saving").click());
  expect(fetchMock.mock.calls[2][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
  expect(fetchMock.mock.calls[2][1]?.headers).toEqual(fetchMock.mock.calls[1][1]?.headers);
  expect(toast.success).toHaveBeenCalledTimes(1);
});

it("offers retry after a failed initial read", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response());
  await render();
  expect(host.textContent).toContain("Store pickup profile could not be loaded");
  await act(async () => button("Refresh pickup details").click());
  expect(host.querySelector<HTMLInputElement>('[name="senderName"]')?.value).toBe("Test store");
});
it("the guided step reuses the saved address and advances only after confirmed contact save", async () => {
  const onSaved = vi.fn();
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes("/locations?"))
      return Response.json({
        ok: true,
        value: { items: [savedLocation], canManage: true, markets: [], nextCursor: null },
      });
    if (init?.method === "PUT")
      return Response.json({
        ok: false,
        error: { code: "STALE_VERSION", message: "Location changed", requestId: "test" },
      });
    return response();
  });
  await act(async () =>
    root.render(
      <LocationDeliveryProfilePanel
        locationId={view.locationId}
        fetchImpl={fetchMock}
        reuseLocationAddress
        onSaved={onSaved}
      />,
    ),
  );
  expect(host.textContent).toContain("Saved entrance");
  expect(host.querySelector('[name="addressLine1"]')).toBeNull();
  await act(async () => button("Save and continue").click());
  const write = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
    addressLine1: "Saved entrance",
    expectedLocationVersion: 8,
  });
  expect(onSaved).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(response());
  await act(async () => button("Save and continue").click());
  expect(onSaved).toHaveBeenCalledTimes(1);
});
