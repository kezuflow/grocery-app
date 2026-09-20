// @vitest-environment jsdom
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { AddToCartButton } from "./add-to-cart-button";
import { addToCart } from "../../../lib/storefront/cart-client";
const state = vi.hoisted(() => ({
  view: null as CartView | null,
  invalidate: vi.fn(async () => undefined),
  toast: vi.fn(),
}));
vi.mock("../../../lib/storefront/cart-client", () => ({
  CART_CHANGED_EVENT: "fm:cart-changed",
  cachedCart: () => state.view,
  quantityForSku: (view: CartView, skuId: string) =>
    view.items.find((item) => item.skuId === skuId)?.quantity ?? 0,
  addToCart: vi.fn().mockResolvedValue({ ok: true }),
  announceToast: state.toast,
}));
vi.mock("../../../lib/query/cart", () => ({
  useCartQuery: () => ({ cart: state.view }),
  useAcceptCart: () => (view: CartView | null) => {
    state.view = view;
  },
  useInvalidateCheckoutReads: () => state.invalidate,
}));
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  state.view = null;
  vi.clearAllMocks();
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
  state.view = {
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

it("shows an accessible pending state and acknowledges success before checkout refresh finishes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finishAdd: (value: Awaited<ReturnType<typeof addToCart>>) => void = () => {};
  let finishInvalidation: () => void = () => {};
  const updated: CartView = {
    id: "cart-test",
    version: 2,
    currency: "PHP",
    items: [
      {
        skuId: "sku-fruit",
        name: "Test fruit",
        quantity: 1,
        unitPriceMinor: 100,
        lineTotalMinor: 100,
        availability: "AVAILABLE",
      },
    ],
    totalMinor: 100,
    checkoutBlocked: false,
    blockingReasons: [],
  };
  vi.mocked(addToCart).mockReturnValueOnce(
    new Promise((resolve) => {
      finishAdd = resolve;
    }),
  );
  state.invalidate.mockReturnValueOnce(
    new Promise<undefined>((resolve) => {
      finishInvalidation = () => resolve(undefined);
    }),
  );
  const control = (
    <AddToCartButton skuId="sku-fruit" productName="Test fruit" unitPriceMinor={100} />
  );
  const host = document.createElement("div");
  host.innerHTML = renderToString(control);
  document.body.appendChild(host);
  await act(async () => {
    root = hydrateRoot(host, control);
  });

  act(() => host.querySelector("button")!.click());
  const pending = host.querySelector("button")!;
  expect(pending.disabled).toBe(true);
  expect(pending.getAttribute("aria-busy")).toBe("true");
  expect(pending.getAttribute("aria-label")).toBe("Adding Test fruit to cart");

  await act(async () => {
    finishAdd({ ok: true, view: updated, count: 1 });
    await Promise.resolve();
  });
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(state.toast).toHaveBeenCalledWith({
    message: "Test fruit added to cart.",
    tone: "success",
  });
  expect(state.invalidate).toHaveBeenCalledTimes(1);

  await act(async () => finishInvalidation());
});
