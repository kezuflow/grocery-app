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
  pricingContext: {
    marketId: "market-metro-cebu",
    locationId: "location-cebu-central",
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
    expect(html).toContain("Missing prices");
    expect(html).toContain("₱25.00–₱30.00");
    expect(html).toContain("0 / 2 available");
    expect(html).toContain("/api/admin/catalog/products/product-onion/media/media-1/content?v=2");
    expect(html).toContain('href="/admin/catalog/products/product-onion?from=status%3Dactive"');
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
        />,
      );
    });

    const productCheckbox = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select Red onion"]',
    );
    expect(productCheckbox).not.toBeNull();

    act(() => productCheckbox?.click());

    expect(container.textContent).toContain("1 selected");
    expect(container.textContent).toContain("Deactivate");
    const cancelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    expect(cancelButton).toBeDefined();

    act(() => cancelButton?.click());

    expect(container.textContent).not.toContain("1 selected");
    expect(onDeactivateSelected).not.toHaveBeenCalled();
  });
});
