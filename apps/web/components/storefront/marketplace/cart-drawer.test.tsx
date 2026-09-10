// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { CartDrawer } from "./cart-drawer";
import { CART_DRAWER_REQUEST_EVENT } from "../../../lib/storefront/cart-client";
import { rememberBrowsingPoint } from "../../../lib/storefront/browsing-location";
vi.mock("./checkout-auth-dialog", () => ({ CheckoutAuthDialog: () => null }));
vi.mock("./order-summary", () => ({
  OrderSummary: ({ cart }: { cart: CartView }) => <p>Total {cart.totalMinor}</p>,
}));
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  rememberBrowsingPoint({ latitude: 10, longitude: 123 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it("uses the mutation response without repeating coverage and cart reads", async () => {
  const initial: CartView = {
    id: "cart-1",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-1",
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
  const updated: CartView = {
    ...initial,
    version: 2,
    totalMinor: 200,
    items: [{ ...initial.items[0], quantity: 2, lineTotalMinor: 200 }],
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    Response.json({
      ok: true,
      value:
        url === "/api/serviceability"
          ? { serviceable: true, fulfillmentLocation: { id: "location-1" } }
          : init?.method === "POST"
            ? updated
            : initial,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CartDrawer />));
  await act(async () => {
    window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Test fruit"]')?.click(),
  );
  expect(fetcher.mock.calls.slice(2).map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
    ["/api/serviceability", "POST"],
    ["/api/commerce/cart", "GET"],
    ["/api/commerce/cart", "POST"],
  ]);
  expect(document.body.textContent).toContain("Total 200");
});
