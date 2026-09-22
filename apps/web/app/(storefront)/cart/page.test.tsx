// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { createQueryClient } from "../../../lib/query/query-client";
import { clearGuestCart } from "../../../lib/storefront/cart-client";
import { rememberBrowsingPoint } from "../../../lib/storefront/browsing-location";
import CartPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("../../../components/storefront/marketplace/checkout-auth-dialog", () => ({
  CheckoutAuthDialog: () => null,
}));
vi.mock("../../../components/storefront/marketplace/order-summary", () => ({
  OrderSummary: ({ cart, disabled }: { cart: CartView | null; disabled?: boolean }) => (
    <>
      <p>Total {cart?.totalMinor ?? 0}</p>
      <button disabled={disabled}>Checkout</button>
    </>
  ),
}));

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  clearGuestCart();
  rememberBrowsingPoint({ latitude: 10, longitude: 123 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("previews a direct-cart quantity request, then accepts the Core result", async () => {
  const initial: CartView = {
    id: "cart-page-preview",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-page-preview",
        name: "Page fruit",
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
  let resolvePost!: (response: Response) => void;
  const post = new Promise<Response>((resolve) => {
    resolvePost = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      url === "/api/serviceability"
        ? Response.json({
            ok: true,
            value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
          })
        : init?.method === "POST"
          ? post
          : Response.json({ ok: true, value: initial }),
    ),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={createQueryClient()}>
        <CartPage />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Page fruit"]')).not.toBeNull(),
  );

  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Page fruit"]')?.click(),
  );
  const stepper = document.querySelector('[aria-label="Increase Page fruit"]')?.parentElement;
  expect(stepper?.querySelector("span")?.textContent).toBe("2");
  expect(document.body.textContent).toContain("Updating quantity…");
  expect(document.body.textContent).toContain("Total 100");
  expect(
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Checkout")
      ?.disabled,
  ).toBe(true);

  await act(async () =>
    resolvePost(
      Response.json({
        ok: true,
        value: {
          ...initial,
          version: 2,
          totalMinor: 200,
          items: [{ ...initial.items[0], quantity: 2, lineTotalMinor: 200 }],
        },
      }),
    ),
  );
  await vi.waitFor(() => expect(document.body.textContent).not.toContain("Updating quantity…"));
  expect(document.body.textContent).toContain("Total 200");
});
