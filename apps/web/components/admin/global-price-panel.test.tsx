// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminCatalogSkuSummary,
  AdminScopeOptionView,
  AdminSkuPricesView,
} from "@freshmarkets/contracts";
import { GlobalPricePanel, LocationPriceEditor } from "./global-price-panel";
vi.mock("./admin-shell", () => ({
  ListPageSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

const skus: AdminCatalogSkuSummary[] = [
  {
    skuId: "sku-1",
    code: "ONION",
    name: "Onion",
    merchandisingLabel: null,
    unitSymbol: "g",
    sellQuantity: 500,
    consumptionBaseQuantity: 500,
    estimatedShippingWeightGrams: 500,
    status: "active",
    sortOrder: 1,
    version: 1,
    priceMinor: null,
    currency: null,
    priceVersion: null,
    availability: null,
    availabilityVersion: null,
  },
];
const scopes: AdminScopeOptionView[] = [
  {
    kind: "location",
    locationId: "location-1",
    locationCode: "CEBU",
    locationName: "Cebu",
    marketId: "market-1",
    marketCode: "CEBU",
    currency: "PHP",
    timezone: "Asia/Manila",
  },
];
const prices: AdminSkuPricesView = {
  skuId: "sku-1",
  locationId: "location-1",
  marketId: "market-1",
  currency: "PHP",
  canManage: true,
  latestVersion: 0,
  currentPriceMinor: null,
  history: [],
};
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
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
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const renderPanel = (onEditPrice = vi.fn()) =>
  act(async () => {
    root.render(<GlobalPricePanel skus={skus} scopes={scopes} onEditPrice={onEditPrice} />);
  });
const renderEditor = () =>
  act(async () => {
    root.render(
      <LocationPriceEditor
        selection={{
          skuId: "sku-1",
          skuName: "Onion",
          locationId: "location-1",
          locationName: "Cebu",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });

describe("Global price editor", () => {
  it("opens the selected selling option and location in the external editor workspace", async () => {
    const onEditPrice = vi.fn();
    fetchMock.mockResolvedValue(response({ ok: true, value: prices, requestId: "test" }));
    await renderPanel(onEditPrice);
    const edit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit price",
    );
    if (!edit) throw new Error("Edit price button missing");
    await act(async () => edit.click());
    expect(onEditPrice).toHaveBeenCalledWith({
      skuId: "sku-1",
      skuName: "Onion",
      locationId: "location-1",
      locationName: "Cebu",
    });
  });

  it("shows unavailable prices and honors the Core read-only decision", async () => {
    fetchMock.mockResolvedValue(
      response({ ok: true, value: { ...prices, canManage: false }, requestId: "test" }),
    );
    await renderPanel();
    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).toContain("Read only");
    expect(container.querySelector("form")).toBeNull();
  });

  it("retains the exact command and key after a lost response", async () => {
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) throw new Error("connection lost");
        return response({
          ok: true,
          value: { ...skus[0], priceMinor: 2550, currency: "PHP", priceVersion: 1 },
          requestId: "test",
        });
      }
      return response({ ok: true, value: prices, requestId: "test" });
    });
    await renderEditor();
    const input = container.querySelector<HTMLInputElement>('[aria-label="Final retail price"]');
    if (!input) throw new Error("Price input missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Missing input setter");
      setter.call(input, "25.50");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("price could not be confirmed");
    expect(input.disabled).toBe(true);
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save price",
    );
    if (!retry) throw new Error("Retry button missing");
    await act(async () => retry.click());
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toBe(writes[1].body);
    expect(writes[0].headers).toEqual(writes[1].headers);
    expect(JSON.parse(String(writes[0].body))).toMatchObject({
      amountMinor: 2550,
      locationId: "location-1",
      marketId: "market-1",
      expectedVersion: 0,
    });
    expect(container.textContent).toContain("price saved");
  });
});
