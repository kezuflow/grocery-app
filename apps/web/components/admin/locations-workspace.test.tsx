// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminLocationsView } from "@freshmarkets/contracts";
import { LocationsWorkspace } from "./locations-workspace";
vi.mock("./admin-shell", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ListPageSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
const view: AdminLocationsView = {
  canManage: true,
  nextCursor: null,
  markets: [{ marketId: "market", name: "Cebu", currency: "PHP", timezone: "Asia/Manila" }],
  items: [
    {
      locationId: "warehouse",
      marketId: "market",
      marketName: "Cebu",
      currency: "PHP",
      timezone: "Asia/Manila",
      code: "warehouse",
      name: "Warehouse",
      purpose: "CENTRAL_WAREHOUSE",
      status: "inactive",
      version: 1,
      latitude: 10.3,
      longitude: 123.9,
      capabilities: ["RECEIVING", "INVENTORY"],
      address: {
        addressLine1: "Test street",
        addressLine2: null,
        barangay: null,
        city: "Cebu",
        region: "Cebu",
        postalCode: null,
        countryCode: "PH",
      },
    },
  ],
};
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown) =>
  new Response(JSON.stringify({ ok: true, value, requestId: "test" }), {
    headers: { "content-type": "application/json" },
  });
function button(text: string) {
  const result = [...container.querySelectorAll("button")].find(
    (value) => value.textContent === text,
  );
  if (!result) throw new Error(`Missing ${text}`);
  return result;
}
beforeEach(() => {
  // jsdom has no layout observer; real browser layout is covered by Playwright.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("location workspace", () => {
  it("honors the Core read-only decision", async () => {
    await act(async () =>
      root.render(
        <LocationsWorkspace
          initial={{ ok: true, requestId: "test", value: { ...view, canManage: false } }}
        />,
      ),
    );
    expect(button("Add location").disabled).toBe(true);
    expect(button("Review Warehouse").disabled).toBe(true);
    expect(container.querySelector("form")).toBeNull();
  });
  it("retries the identical location intent after an unknown response", async () => {
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) throw new Error("lost response");
        return response(view.items[0]);
      }
      return response(view);
    });
    await act(async () =>
      root.render(<LocationsWorkspace initial={{ ok: true, requestId: "test", value: view }} />),
    );
    await act(async () => button("Review Warehouse").click());
    const input = container.querySelector<HTMLInputElement>("#location-reason");
    if (!input) throw new Error("Missing reason");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Missing setter");
      setter.call(input, "Verify receiving address");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.textContent).toContain("outcome is unknown");
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => button("Retry saved command").click());
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toBe(writes[1].body);
    expect(writes[0].headers).toEqual(writes[1].headers);
    expect(JSON.parse(String(writes[0].body))).toMatchObject({
      action: "UPDATE",
      locationId: "warehouse",
      expectedVersion: 1,
      reason: "Verify receiving address",
    });
    expect(container.textContent).toContain("Location saved.");
  });
});
