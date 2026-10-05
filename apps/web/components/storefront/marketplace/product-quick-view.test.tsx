// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductQuickView } from "./product-quick-view";
import type { CatalogVariant, MarketplaceProductView } from "@freshmarkets/contracts";
import { ProductView } from "../../../app/(storefront)/products/[slug]/product-view";
import { DELIVERY_LOCATION_REQUEST_EVENT } from "../../../lib/storefront/browsing-location";

const cart = vi.hoisted(() => ({
  addToCart: vi.fn(async () => ({ ok: true, requiresSignIn: false })),
  announceToast: vi.fn(),
}));
vi.mock("../../../lib/storefront/cart-client", () => cart);

let root: Root;
let resolve: (response: Response) => void;
let reject: (error: Error) => void;
const close = vi.fn();
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  close.mockClear();
  cart.addToCart.mockClear();
  cart.announceToast.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    ),
  );
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
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(slug: string | null) {
  await act(async () =>
    root.render(
      <ProductQuickView slug={slug} products={[]} onClose={close} onNavigate={() => {}} />,
    ),
  );
}
it("opens and offers a close button while the detail request is still pending", async () => {
  await render("abiu");
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Loading current options",
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Close product details"]')!.click(),
  );
  expect(close).toHaveBeenCalledOnce();
});
it("shows a visible error when the request fails", async () => {
  await render("abiu");
  await act(async () => reject(new Error("offline")));
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
});
it("does not reopen a closed dialog when an aborted request completes late", async () => {
  await render("abiu");
  await render(null);
  await act(async () => resolve(Response.json({ ok: false })));
  expect(document.querySelector("dialog")?.open).toBe(false);
});

it("ends a hung read and retries only when requested", async () => {
  vi.useFakeTimers();
  await render("abiu");
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
  expect(fetch).toHaveBeenCalledTimes(1);
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  expect(retry).toBeDefined();
  await act(async () => retry?.click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[aria-label="Loading product"]')).not.toBeNull();
  await act(async () => resolve(Response.json({ ok: false })));
});

function productView(availability: CatalogVariant["availability"]): MarketplaceProductView {
  const priced = availability === "AVAILABLE" || availability === "OUT_OF_STOCK";
  return {
    product: {
      id: "product-abiu",
      slug: "abiu",
      name: "Abiu",
      description: null,
      category: { code: "fruit", name: "Fruit", slug: "fruit" },
      media: null,
      details: [],
      available: availability === "AVAILABLE",
      variants: [
        {
          id: "sku-abiu",
          code: "abiu",
          name: "One piece",
          merchandisingLabel: null,
          sellQuantity: 1,
          sellUnitCode: "PC",
          unit: "piece",
          consumptionBaseQuantity: 1,
          contentsNote: null,
          priceMinor: priced ? 10000 : null,
          currency: priced ? "PHP" : null,
          priceVersion: priced ? 1 : null,
          availability,
        },
      ],
    },
    images: [],
    deliveryContext: { locationAware: availability !== "LOCATION_REQUIRED" },
  };
}

for (const surface of ["quick view", "product page"] as const) {
  async function showProduct(availability: CatalogVariant["availability"]) {
    const view = productView(availability);
    if (surface === "quick view") {
      await render("abiu");
      await act(async () => resolve(Response.json({ ok: true, value: view })));
    } else {
      await act(async () => root.render(<ProductView view={view} />));
    }
  }

  it(`${surface} opens location selection instead of attempting an unlocated cart addition`, async () => {
    await showProduct("LOCATION_REQUIRED");
    expect(document.body.textContent).toContain("Set your delivery location first");
    expect(document.body.textContent).toContain("supported areas in Cebu");
    expect(document.body.textContent).not.toContain("Currently unavailable");
    const action = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Set delivery location"),
    );
    expect(action?.disabled).toBe(false);
    const requested = vi.fn(() => {
      if (surface === "quick view") expect(document.querySelector("dialog")?.open).toBe(false);
    });
    window.addEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requested);
    try {
      await act(async () => action?.click());
      expect(requested).toHaveBeenCalledOnce();
      expect(cart.addToCart).not.toHaveBeenCalled();
      if (surface === "quick view") expect(close).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(DELIVERY_LOCATION_REQUEST_EVENT, requested);
    }
  });

  for (const availability of ["OUT_OF_STOCK", "PRICE_UNAVAILABLE"] as const) {
    it(`${surface} keeps ${availability} disabled instead of requesting a location`, async () => {
      await showProduct(availability);
      expect(document.body.textContent).not.toContain("Set your delivery location first");
      const action = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Add to cart"),
      );
      expect(action?.disabled).toBe(true);
      await act(async () => action?.click());
      expect(cart.addToCart).not.toHaveBeenCalled();
    });
  }

  it(`${surface} still adds a priced available item to the cart`, async () => {
    await showProduct("AVAILABLE");
    expect(document.body.textContent).not.toContain("Set your delivery location first");
    const action = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add to cart"),
    );
    expect(action?.disabled).toBe(false);
    await act(async () => action?.click());
    expect(cart.addToCart).toHaveBeenCalledWith("sku-abiu", 1, {
      name: "Abiu",
      media: null,
      unitPriceMinor: 10000,
      currency: "PHP",
    });
  });
}
