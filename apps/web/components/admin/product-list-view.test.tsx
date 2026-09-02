// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminProductPage } from "@freshmarkets/contracts";

vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & {
    prefetch?: boolean;
  }) => <a {...props}>{children}</a>,
}));

import { ProductListView } from "./product-list-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page: AdminProductPage = {
  items: [
    {
      productId: "product-onion",
      slug: "red-onion",
      name: "Red onion",
      categoryCode: "VEGETABLES",
      status: "active",
      skuCount: 2,
      activeSkuCount: 2,
      pricedSkuCount: 1,
      availableSkuCount: 0,
      primaryMedia: { mediaId: "media-1", altText: "Red onions", version: 2 },
      priceRange: { minimumMinor: 2_500, maximumMinor: 3_000, currency: "PHP" },
      inventoryPosition: {
        locationId: "location-cebu-central",
        onHandBase: 10_000,
        reservedBase: 1_000,
        availableBase: 9_000,
        version: 2,
      },
      version: 3,
    },
  ],
  readiness: {
    activeProducts: 1,
    inactiveProducts: 0,
    missingPrimaryMedia: 0,
    missingPrices: 1,
    unavailableSkus: 2,
  },
  scope: {
    kind: "LOCATION",
    marketId: "market-metro-cebu",
    marketName: "Metro Cebu",
    locationId: "location-cebu-central",
    locationName: "Central Cebu",
    currency: "PHP",
  },
  nextCursor: null,
};

describe("ProductListView", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("renders catalog readiness, secure media, resolved prices, and availability", () => {
    const html = renderToStaticMarkup(<ProductListView page={page} fromQuery="status=active" />);
    expect(html).toContain("Catalog readiness");
    expect(html).toContain("Missing location prices");
    expect(html).toContain("₱25.00–₱30.00");
    expect(html).toContain("0 / 2 selling");
    expect(html).toContain("9,000 available");
    expect(html).toContain(
      "/api/admin/catalog/products/product-onion/media/media-1/content?v=2&amp;locationId=location-cebu-central",
    );
    expect(html).toContain('aria-label="Open actions for Red onion"');
    expect(html).not.toContain(">View</a>");
    expect(html).toContain("rounded-full");
    expect(html).toContain("Columns");
    expect(html).toContain(">Variants</th>");
    expect(html).toContain(">Status</th>");
    expect(html).not.toContain("Variant readiness");
    expect(html).not.toContain("Catalog status");
    expect(html).not.toContain("active variants priced");
    expect(html).not.toContain("active variants");
    expect(html).not.toContain("objectKey");
    expect(html).not.toContain("Rating");
  });

  it("shows the bulk action toolbar after selecting a product and clears it on cancel", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onDeactivateSelected = vi.fn();

    act(() => {
      root?.render(
        <ProductListView
          page={page}
          fromQuery="status=active"
          canManage
          onDeactivateSelected={onDeactivateSelected}
          filters={<input aria-label="Search products" />}
        />,
      );
    });

    expect(container.textContent).toContain("Filters");
    expect(container.textContent).toContain("Columns");

    const productCheckbox = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select Red onion"]',
    );
    expect(productCheckbox).not.toBeNull();

    act(() => productCheckbox?.click());

    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("Deactivate");
    expect(container.textContent).not.toContain("Filters");
    expect(container.textContent).not.toContain("Columns");
    const cancelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    expect(cancelButton).toBeDefined();

    act(() => cancelButton?.click());

    expect(container.textContent).not.toContain("1 selected");
    expect(container.textContent).toContain("Filters");
    expect(container.textContent).toContain("Columns");
    expect(onDeactivateSelected).not.toHaveBeenCalled();
  });

  it("opens a vertical row action menu with product commands", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProductListView
          page={page}
          fromQuery="status=active"
          canManage
          onDeactivateSelected={vi.fn()}
        />,
      );
    });

    const actions = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open actions for Red onion"]',
    );
    expect(actions?.querySelector(".lucide-ellipsis-vertical")).not.toBeNull();

    await act(async () => {
      actions?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("View details");
    expect(document.body.textContent).toContain("Edit product");
    expect(document.body.textContent).toContain("Copy ID");
    expect(document.body.textContent).toContain("Deactivate");
  });
});
