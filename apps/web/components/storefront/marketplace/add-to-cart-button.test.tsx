// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { AddToCartButton } from "./add-to-cart-button";
import { addToCart } from "../../../lib/storefront/cart-client";
const cache = vi.hoisted(() => ({ view: null as CartView | null }));
vi.mock("../../../lib/storefront/cart-client", () => ({
  CART_CHANGED_EVENT: "fm:cart-changed",
  cachedCart: () => cache.view,
  quantityForSku: (view: CartView, skuId: string) =>
    view.items.find((item) => item.skuId === skuId)?.quantity ?? 0,
  addToCart: vi.fn().mockResolvedValue({ ok: true }),
  announceToast: vi.fn(),
}));
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  cache.view = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it("hydrates server Add markup when the header fills the cart cache before the card arrives", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const control = (
    <AddToCartButton skuId="sku-fruit" productName="Test fruit" unitPriceMinor={100} />
  );
  const host = document.createElement("div");
  host.innerHTML = renderToString(control);
  document.body.appendChild(host);
  expect(host.querySelector('[aria-label="Add Test fruit to cart"]')).not.toBeNull();
  // Reproduce the header finishing its cart read before this Suspense boundary hydrates.
  cache.view = {
    id: "cart-test",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-fruit",
        name: "Test fruit",
        quantity: 2,
        unitPriceMinor: 100,
        lineTotalMinor: 200,
        availability: "AVAILABLE",
      },
    ],
    totalMinor: 200,
    checkoutBlocked: false,
    blockingReasons: [],
  };
  const onRecoverableError = vi.fn();
  await act(async () => {
    root = hydrateRoot(host, control, { onRecoverableError });
  });
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Remove one Test fruit"]')).toBeNull();
  expect(host.querySelectorAll("button")).toHaveLength(1);
  await act(async () => {
    host.querySelector("button")!.click();
  });
  expect(addToCart).toHaveBeenCalledWith("sku-fruit", 3, expect.any(Object));
  expect(host.querySelectorAll("button")).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new CustomEvent("fm:cart-changed", { detail: { view: null, count: 0 } }));
  });
  expect(host.querySelector('[aria-label="Add Test fruit to cart"]')).not.toBeNull();
});
