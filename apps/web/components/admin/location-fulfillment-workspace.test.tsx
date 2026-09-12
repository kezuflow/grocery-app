// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AdminLocationFulfillmentView } from "@freshmarkets/contracts";
import { LocationFulfillmentWorkspace } from "./location-fulfillment-workspace";

vi.mock("./admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const initial: AdminLocationFulfillmentView = {
  locationId: "location-cebu-central",
  locationName: "Central Cebu",
  version: 6,
  dispatchReady: false,
  instantPromiseMinutes: null,
  blockers: [],
  canManage: true,
};
const fetchMock = vi.fn<typeof fetch>();
let host: HTMLDivElement;
let root: Root;
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function checkbox() {
  const found = host.querySelector<HTMLButtonElement>('[role="checkbox"]');
  if (!found) throw new Error("Missing readiness checkbox");
  return found;
}
function reasonInput() {
  const found = host.querySelector<HTMLInputElement>("input[required]");
  if (!found) throw new Error("Missing reason");
  return found;
}
async function enterReason() {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing input setter");
    setter.call(reasonInput(), "Reviewed site setup");
    reasonInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(patch: Partial<AdminLocationFulfillmentView> = {}) {
  await act(async () =>
    root.render(
      <LocationFulfillmentWorkspace
        initial={{ ok: true, requestId: "test", value: { ...initial, ...patch } }}
        locationId={initial.locationId}
      />,
    ),
  );
}
function success() {
  return Response.json({
    ok: true,
    requestId: "test",
    value: { ...initial, version: 7, dispatchReady: true },
  });
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

it("distinguishes a checked draft from saved readiness and requires a reason", async () => {
  await render();
  expect(button("Save fulfillment settings").disabled).toBe(true);
  await act(async () => checkbox().click());
  expect(host.textContent).toContain("Saved dispatch status: Not ready");
  expect(host.textContent).toContain("Unsaved changes");
  await act(async () => button("Save fulfillment settings").click());
  expect(reasonInput().validity.valueMissing).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

it("shows pending feedback and only announces readiness after Core confirms it", async () => {
  let resolve: (response: Response) => void = () => {
    throw new Error("No pending request");
  };
  fetchMock.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => checkbox().click());
  await enterReason();
  await act(async () => button("Save fulfillment settings").click());
  expect(button("Saving…").disabled).toBe(true);
  expect(checkbox().disabled).toBe(true);
  expect(host.textContent).toContain("Saved dispatch status: Not ready");
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => resolve(success()));
  expect(host.textContent).toContain("Saved dispatch status: Ready");
  expect(host.textContent).toContain("No unsaved changes");
  expect(toast.success).toHaveBeenCalledExactlyOnceWith("Fulfillment settings saved", {
    description: undefined,
  });
  expect(reasonInput().value).toBe("");
});

it.each([
  ["VALIDATION_FAILED", "Configure the courier pickup profile"],
  ["STALE_VERSION", "The location changed"],
])("keeps %s visible without reporting success", async (code, message) => {
  fetchMock.mockResolvedValue(
    Response.json({ ok: false, error: { code, message, requestId: "test" } }),
  );
  await render({ blockers: ["Configure the courier pickup profile"] });
  await act(async () => checkbox().click());
  await enterReason();
  await act(async () => button("Save fulfillment settings").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
  expect(host.textContent).toContain("Saved dispatch status: Not ready");
  expect(reasonInput().value).toBe("Reviewed site setup");
  expect(toast.success).not.toHaveBeenCalled();
  expect(host.querySelector('a[href="/admin/delivery"]')).not.toBeNull();
});

it("retries an unconfirmed save with the original payload and identity", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(success());
  await render();
  await act(async () => checkbox().click());
  await enterReason();
  await act(async () => button("Save fulfillment settings").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Save not confirmed");
  expect(checkbox().disabled).toBe(true);
  expect(button("Refresh settings").disabled).toBe(true);
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => button("Retry saving").click());
  const first = fetchMock.mock.calls[0][1];
  const retry = fetchMock.mock.calls[1][1];
  expect(retry?.body).toBe(first?.body);
  expect(retry?.headers).toEqual(first?.headers);
  expect(host.textContent).toContain("Saved dispatch status: Ready");
});

it("refreshes readiness and exposes failed reads", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(success());
  await render();
  await act(async () => button("Refresh settings").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Settings could not be loaded",
  );
  await act(async () => button("Refresh settings").click());
  expect(host.textContent).toContain("Saved dispatch status: Ready");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
