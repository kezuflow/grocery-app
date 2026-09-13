// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LocationSetupProvider, useSetupNavigationLock } from "./location-setup-state";
import { LocationSetupNavigation } from "./location-setup-navigation";
import { LocationReviewStep } from "./location-review-step";
const route = vi.hoisted(() => ({ pathname: "/admin/locations/central/pickup" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("./admin-shell", () => ({ PageHeader: () => null }));
const location = {
  locationId: "central",
  marketId: "cebu",
  marketName: "Cebu",
  currency: "PHP",
  timezone: "Asia/Manila",
  code: "central",
  name: "Central Cebu",
  purpose: "CUSTOMER_FULFILLMENT",
  status: "inactive",
  version: 1,
  addressProviderDerived: false,
  latitude: 10.3,
  longitude: 123.9,
  capabilities: ["PICKING", "PACKING", "DISPATCH"],
  address: {
    addressLine1: "Saved street",
    addressLine2: null,
    barangay: null,
    city: "Cebu",
    region: "Cebu",
    postalCode: null,
    countryCode: "PH",
  },
};
const readiness = {
  locationId: "central",
  locationName: "Central Cebu",
  version: 1,
  dispatchReady: false,
  instantPromiseMinutes: null,
  blockers: ["Activate this fulfillment location"],
  canManage: true,
};
const fetchMock = vi.fn<typeof fetch>();
let host: HTMLDivElement;
let root: Root;
const ok = (value: unknown) => Response.json({ ok: true, requestId: "test", value });
function Lock({ active }: { active: boolean }) {
  useSetupNavigationLock(active);
  return null;
}
function button(name: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  location.status = "inactive";
  location.version = 1;
  readiness.version = 1;
  route.pathname = "/admin/locations/central/pickup";
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes("/locations?"))
      return ok({ items: [location], canManage: true, markets: [], nextCursor: null });
    if (path.includes("/location-fulfillment?")) return ok(readiness);
    if (path.includes("/location-schedule?"))
      return ok({
        locationId: "central",
        locationName: "Central Cebu",
        version: 1,
        timezone: "Asia/Manila",
        schedule: null,
        canManage: true,
      });
    return ok({
      locationId: "central",
      locationName: "Central Cebu",
      coordinate: { latitude: 10.3, longitude: 123.9 },
      profile: null,
    });
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(locked = false, review = false) {
  await act(async () =>
    root.render(
      <LocationSetupProvider locationId="central">
        <LocationSetupNavigation locationId="central" />
        <Lock active={locked} />
        {review && <LocationReviewStep locationId="central" />}
      </LocationSetupProvider>,
    ),
  );
}
it("shows saved versus incomplete steps and blocks step navigation during an unconfirmed save", async () => {
  await render();
  expect(host.textContent).toContain("Step 2 of 4");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(
    "Pickup contactIncomplete",
  );
  expect(host.textContent).toContain("LocationSaved");
  expect(host.textContent).toContain("Instant operating hoursIncomplete");
  await render(true);
  const links = [...host.querySelectorAll("a")];
  expect(links.every((link) => link.getAttribute("aria-disabled") === "true")).toBe(true);
  expect(links[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    false,
  );
  await render(false);
  expect(host.querySelector('a[aria-disabled="true"]')).toBeNull();
});
it("keeps unavailable setup reads distinct from incomplete configuration", async () => {
  fetchMock.mockRejectedValue(new Error("Offline"));
  await render();
  expect(host.textContent).toContain("Pickup contactUnavailable");
  expect(host.textContent).not.toContain("Incomplete");
});
it("locks review refresh and edit links while a child save is unconfirmed", async () => {
  route.pathname = "/admin/locations/central/fulfillment";
  await render(true, true);
  expect(button("Refresh review").disabled).toBe(true);
  expect(button("Activate location").disabled).toBe(true);
  expect(
    [...host.querySelectorAll("a")].every((link) => link.getAttribute("aria-disabled") === "true"),
  ).toBe(true);
  await render(false, true);
  expect(button("Refresh review").disabled).toBe(false);
});
it("retries the reviewed activation without enabling dispatch or losing the original intent", async () => {
  route.pathname = "/admin/locations/central/fulfillment";
  const reads = fetchMock.getMockImplementation();
  let attempts = 0;
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      attempts += 1;
      if (attempts === 1) throw new Error("Response lost");
      location.status = "active";
      location.version = 2;
      readiness.version = 2;
      return ok(location);
    }
    if (!reads) throw new Error("Missing reads");
    return reads(url, init);
  });
  await render(false, true);
  const input = [...host.querySelectorAll("label")]
    .find((label) => label.textContent?.startsWith("Reason for activation"))
    ?.querySelector("input");
  if (!input) throw new Error("Missing activation reason");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "Setup reviewed",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Activate location").click());
  expect(host.textContent).toContain("Activation not confirmed");
  await act(async () => button("Retry activation").click());
  const writes = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[1][1]?.body).toBe(writes[0][1]?.body);
  expect(writes[1][1]?.headers).toEqual(writes[0][1]?.headers);
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({
    action: "ACTIVATE",
    expectedVersion: 1,
  });
  expect(host.textContent).toContain("Saved dispatch status: Not ready");
});
