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
vi.mock("../maps/google-map", () => ({
  GoogleMap: ({
    onPinMove,
    scene,
  }: {
    onPinMove: (point: { latitude: number; longitude: number }) => void;
    scene: { draggablePin?: unknown; points?: readonly unknown[] };
  }) => (
    <button
      type="button"
      data-draggable-pin={scene.draggablePin ? "true" : "false"}
      data-static-points={String(scene.points?.length ?? 0)}
      onClick={() => onPinMove({ latitude: 10.35, longitude: 123.92 })}
    >
      Move test pin
    </button>
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
      addressProviderDerived: false,
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
  it("keeps temporary provider provenance when an operator moves the search-result pin", async () => {
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url).includes("address-prediction"))
        return response({
          candidateKey: "candidate",
          displayAddress: "Search result",
          coordinate: { latitude: 10.3, longitude: 123.9 },
          accuracy: null,
          components: view.items[0].address,
        });
      if (String(url).includes("address-autocomplete"))
        return response([
          {
            candidateKey: "candidate",
            displayAddress: "Search result",
            coordinate: { latitude: 10.3, longitude: 123.9 },
            accuracy: null,
            components: view.items[0].address,
          },
        ]);
      if (options?.method === "POST") {
        writes.push(options);
        return response(view.items[0]);
      }
      return response(view);
    });
    await act(async () =>
      root.render(<LocationsWorkspace initial={{ ok: true, requestId: "test", value: view }} />),
    );
    await act(async () => button("Review Warehouse").click());
    expect(container.textContent).toContain("Fulfillment location pin");
    expect(container.textContent).toContain("Pin set");
    expect(button("Move test pin").dataset.draggablePin).toBe("true");
    expect(button("Move test pin").dataset.staticPoints).toBe("0");
    async function fill(selector: string, value: string) {
      const input = container.querySelector<HTMLInputElement>(selector);
      if (!input) throw new Error("Missing input");
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) throw new Error("Missing setter");
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await fill("#location-address-search", "Store street");
    await act(async () => button("Search").click());
    await act(async () => button("Search result").click());
    await act(async () => button("Move test pin").click());
    await fill("#location-reason", "Confirm pickup entrance");
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].body))).toMatchObject({
      componentsSource: "TEMPORARY_GEOCODER",
      confirmationSource: "USER_PIN",
      latitude: 10.35,
      longitude: 123.92,
    });
  });
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
