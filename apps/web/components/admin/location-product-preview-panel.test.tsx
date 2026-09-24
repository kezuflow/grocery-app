// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProductDetail, AdminSkuPricesView } from "@freshmarkets/contracts";
import { LocationProductPreviewPanel } from "./location-product-preview-panel";

const product = {
  productId: "product-1",
  categoryId: "category-1",
  slug: "zucchini",
  name: "Zucchini",
  description: "Fresh zucchini.",
  categoryCode: "VEGETABLES",
  categoryName: "Vegetables",
  categories: [{ categoryId: "category-1", code: "VEGETABLES", name: "Vegetables" }],
  status: "active",
  version: 3,
  customerDetails: [],
  media: [],
  inventoryPool: {
    inventoryPoolId: "pool-1",
    baseUnitId: "unit-gram",
    baseUnitCode: "GRAM",
    baseUnitSymbol: "g",
    position: {
      locationId: "location-1",
      onHandBase: 20_000,
      reservedBase: 2_000,
      availableBase: 18_000,
      version: 2,
    },
  },
  scope: {
    kind: "LOCATION",
    marketId: "market-1",
    marketName: "Metro Cebu",
    locationId: "location-1",
    locationName: "Central Cebu",
    currency: "PHP",
  },
  allowedActions: [],
  recentAudit: [],
  skus: [
    {
      skuId: "sku-1",
      code: "ZUCCHINI_1KG",
      name: "Zucchini · 1 kg",
      merchandisingLabel: null,
      unitSymbol: "kg",
      sellQuantity: 1,
      consumptionBaseQuantity: 1_000,
      estimatedShippingWeightGrams: 1_000,
      status: "active",
      sortOrder: 1,
      version: 1,
      priceMinor: 8_500,
      currency: "PHP",
      priceVersion: 1,
      availability: "AVAILABLE",
      availabilityVersion: 1,
    },
  ],
} satisfies AdminProductDetail;

const prices: AdminSkuPricesView = {
  skuId: "sku-1",
  locationId: "location-1",
  marketId: "market-1",
  currency: "PHP",
  canManage: true,
  latestVersion: 1,
  currentPriceMinor: 8_500,
  history: [
    {
      version: 1,
      amountMinor: 8_500,
      currency: "PHP",
      validFrom: 1,
      validTo: null,
    },
  ],
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

async function renderPreview(
  onRecoveryStateChange = vi.fn(),
  onPriceSaved = vi.fn(),
  canManagePrices = true,
) {
  await act(async () => {
    root.render(
      <LocationProductPreviewPanel
        product={product}
        fromQuery=""
        canManagePrices={canManagePrices}
        onClose={vi.fn()}
        onPriceSaved={onPriceSaved}
        onRecoveryStateChange={onRecoveryStateChange}
      />,
    );
  });
}

describe("LocationProductPreviewPanel", () => {
  it("renders a distinct fulfillment preview and opens the price editor from the price", async () => {
    fetchMock.mockResolvedValue(response({ ok: true, value: prices, requestId: "test" }));
    await renderPreview();

    expect(container.textContent).toContain("Central Cebu fulfillment preview");
    expect(container.textContent).toContain("Location selling options");
    expect(container.textContent).toContain("Click a price to change it for Central Cebu only.");
    expect(container.textContent).not.toContain("Metro Cebu");
    expect(container.textContent).toContain("Physical stock20,000 g");
    expect(container.textContent).toContain("Reserved stock2,000 g");
    expect(container.textContent).toContain("Available stock18,000 g");

    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit price for Zucchini · 1 kg"]',
    );
    if (!edit) throw new Error("Editable price missing");
    await act(async () => edit.click());
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Price for Zucchini · 1 kg"]')?.value,
    ).toBe("85.00");
  });

  it("shows static prices and ownership copy without management access", async () => {
    await renderPreview(vi.fn(), vi.fn(), false);

    expect(container.textContent).toContain(
      "Prices for Central Cebu are view-only with your current access.",
    );
    expect(container.textContent).toContain("₱85.00");
    expect(container.querySelector('[aria-label="Edit price for Zucchini · 1 kg"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("settles an authoritative denied price read into view-only state", async () => {
    fetchMock.mockResolvedValue(
      response({ ok: true, value: { ...prices, canManage: false }, requestId: "test" }),
    );
    await renderPreview();
    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit price for Zucchini · 1 kg"]',
    );
    if (!edit) throw new Error("Editable price missing");
    await act(async () => edit.click());

    expect(container.textContent).toContain("You do not have price-management access");
    expect(container.querySelector('[aria-label="Edit price for Zucchini · 1 kg"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Price for Zucchini · 1 kg"]')).toBeNull();
    expect(container.textContent).not.toContain("Retry price");
  });

  it("retains the exact location command and key after a lost response", async () => {
    const onRecoveryStateChange = vi.fn();
    const onPriceSaved = vi.fn();
    const writes: RequestInit[] = [];
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) throw new Error("connection lost");
        return response({
          ok: true,
          value: { ...product.skus[0], priceMinor: 9_950, priceVersion: 2 },
          requestId: "test",
        });
      }
      return response({ ok: true, value: prices, requestId: "test" });
    });
    await renderPreview(onRecoveryStateChange, onPriceSaved);

    const edit = container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit price for Zucchini · 1 kg"]',
    );
    if (!edit) throw new Error("Editable price missing");
    await act(async () => edit.click());
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Price for Zucchini · 1 kg"]',
    );
    if (!input) throw new Error("Price input missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Missing input setter");
      setter.call(input, "99.50");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("price could not be confirmed");
    expect(onRecoveryStateChange).toHaveBeenCalledWith(true);
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry save",
    );
    if (!retry) throw new Error("Retry save button missing");
    await act(async () => retry.click());

    expect(writes).toHaveLength(2);
    expect(writes[0].body).toBe(writes[1].body);
    expect(writes[0].headers).toEqual(writes[1].headers);
    expect(JSON.parse(String(writes[0].body))).toMatchObject({
      skuId: "sku-1",
      locationId: "location-1",
      marketId: "market-1",
      amountMinor: 9_950,
      expectedVersion: 1,
    });
    expect(container.textContent).toContain("Location price saved.");
    expect(container.textContent).toContain("₱99.50");
    expect(onPriceSaved).toHaveBeenCalledOnce();
    expect(onRecoveryStateChange).toHaveBeenLastCalledWith(false);
  });
});
