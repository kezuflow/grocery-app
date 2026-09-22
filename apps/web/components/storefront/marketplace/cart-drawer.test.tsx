// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { CartDrawer } from "./cart-drawer";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../../../lib/query/query-client";
import { CART_DRAWER_REQUEST_EVENT, clearGuestCart } from "../../../lib/storefront/cart-client";
import { rememberBrowsingPoint } from "../../../lib/storefront/browsing-location";
vi.mock("./checkout-auth-dialog", () => ({ CheckoutAuthDialog: () => null }));
vi.mock("./order-summary", () => ({
  OrderSummary: ({ cart, disabled }: { cart: CartView; disabled?: boolean }) => (
    <>
      <p>Total {cart.totalMinor}</p>
      <button disabled={disabled}>Checkout</button>
    </>
  ),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
let root: Root;
const drawer = () => (
  <QueryClientProvider client={createQueryClient()}>
    <CartDrawer />
  </QueryClientProvider>
);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  clearGuestCart();
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
  vi.useRealTimers();
  document.body.style.cssText = "";
  document.documentElement.style.cssText = "";
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
  await act(async () => root.render(drawer()));
  await act(async () => {
    window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Test fruit"]')).not.toBeNull(),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  const quantityControl = document.querySelector<HTMLButtonElement>(
    '[aria-label="Increase Test fruit"]',
  )?.parentElement;
  const quantityPriceRow = quantityControl?.parentElement;
  expect(quantityPriceRow?.className).toContain("justify-between");
  expect(quantityPriceRow?.lastElementChild?.className).toContain("text-right");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Test fruit"]')?.click(),
  );
  expect(fetcher.mock.calls.slice(2).map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
    ["/api/commerce/cart", "POST"],
  ]);
  expect(document.body.textContent).toContain("Total 200");
});

it("previews a requested quantity immediately without treating the old total as confirmed", async () => {
  const initial: CartView = {
    id: "cart-preview",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-preview",
        name: "Preview fruit",
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
  const response = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      url === "/api/serviceability"
        ? Response.json({
            ok: true,
            value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
          })
        : init?.method === "POST"
          ? response.promise
          : Response.json({ ok: true, value: initial }),
    ),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Preview fruit"]')).not.toBeNull(),
  );

  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Preview fruit"]')?.click(),
  );
  const stepper = document.querySelector('[aria-label="Increase Preview fruit"]')?.parentElement;
  expect(stepper?.querySelector("span")?.textContent).toBe("2");
  expect(stepper?.nextElementSibling?.getAttribute("aria-label")).toBe("Updating quantity");
  expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("Updating quantity…");
  expect(document.body.textContent).toContain("Total 100");
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Checkout",
    )?.disabled,
  ).toBe(true);
  expect(
    document.querySelector('[aria-label="Increase Preview fruit"]')?.hasAttribute("disabled"),
  ).toBe(false);

  await act(async () =>
    response.resolve(
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
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).toBeNull(),
  );
  expect(document.body.textContent).toContain("Total 200");
  expect(
    document.querySelector('[aria-label="Increase Preview fruit"]')?.hasAttribute("disabled"),
  ).toBe(false);
});

it("coalesces rapid taps on one line into one versioned follow-up command", async () => {
  const initial: CartView = {
    id: "cart-rapid",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-rapid",
        name: "Rapid fruit",
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
  const first = deferred<Response>();
  const second = deferred<Response>();
  const commands: Array<{ quantity: number; expectedVersion: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/serviceability")
        return Response.json({
          ok: true,
          value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
        });
      if (init?.method === "POST") {
        commands.push(JSON.parse(String(init.body)));
        return commands.length === 1 ? first.promise : second.promise;
      }
      return Response.json({ ok: true, value: initial });
    }),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Rapid fruit"]')).not.toBeNull(),
  );
  const increase = () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Rapid fruit"]')?.click();
  const decrease = () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Decrease Rapid fruit"]')?.click();
  const count = () =>
    document
      .querySelector('[aria-label="Increase Rapid fruit"]')
      ?.parentElement?.querySelector("span")?.textContent;

  act(increase);
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({ quantity: 2, expectedVersion: 1 });
  act(() => {
    increase();
    increase();
    decrease();
    increase();
  });
  expect(count()).toBe("4");
  expect(commands).toHaveLength(1);
  expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Total 100");
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Rapid fruit"]')?.disabled,
  ).toBe(false);

  await act(async () =>
    first.resolve(
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
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]).toMatchObject({ quantity: 4, expectedVersion: 2 });
  expect(count()).toBe("4");
  await act(async () =>
    second.resolve(
      Response.json({
        ok: true,
        value: {
          ...initial,
          version: 3,
          totalMinor: 400,
          items: [{ ...initial.items[0], quantity: 4, lineTotalMinor: 400 }],
        },
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).toBeNull(),
  );
  expect(count()).toBe("4");
  expect(document.body.textContent).toContain("Total 400");
  expect(commands).toHaveLength(2);
});

it("queues a second SKU behind the first cart version", async () => {
  const initial: CartView = {
    id: "cart-two-lines",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-a",
        name: "Fruit A",
        quantity: 1,
        unitPriceMinor: 100,
        lineTotalMinor: 100,
        availability: "AVAILABLE",
      },
      {
        skuId: "sku-b",
        name: "Fruit B",
        quantity: 1,
        unitPriceMinor: 200,
        lineTotalMinor: 200,
        availability: "AVAILABLE",
      },
    ],
    totalMinor: 300,
    checkoutBlocked: false,
    blockingReasons: [],
  };
  const first = deferred<Response>();
  const second = deferred<Response>();
  const commands: Array<{ skuId: string; quantity: number; expectedVersion: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/serviceability")
        return Response.json({
          ok: true,
          value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
        });
      if (init?.method === "POST") {
        commands.push(JSON.parse(String(init.body)));
        return commands.length === 1 ? first.promise : second.promise;
      }
      return Response.json({ ok: true, value: initial });
    }),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Fruit B"]')).not.toBeNull(),
  );
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Increase Fruit A"]')?.click());
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Increase Fruit B"]')?.click());
  expect(commands).toHaveLength(1);
  expect(
    document.querySelector('[aria-label="Increase Fruit B"]')?.parentElement?.textContent,
  ).toContain("2");

  await act(async () =>
    first.resolve(
      Response.json({
        ok: true,
        value: {
          ...initial,
          version: 2,
          totalMinor: 400,
          items: [{ ...initial.items[0], quantity: 2, lineTotalMinor: 200 }, initial.items[1]],
        },
      }),
    ),
  );
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  expect(commands).toMatchObject([
    { skuId: "sku-a", quantity: 2, expectedVersion: 1 },
    { skuId: "sku-b", quantity: 2, expectedVersion: 2 },
  ]);
  await act(async () =>
    second.resolve(
      Response.json({
        ok: true,
        value: {
          ...initial,
          version: 3,
          totalMinor: 600,
          items: [
            { ...initial.items[0], quantity: 2, lineTotalMinor: 200 },
            { ...initial.items[1], quantity: 2, lineTotalMinor: 400 },
          ],
        },
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelectorAll('[role="status"][aria-label="Updating quantity"]'),
    ).toHaveLength(0),
  );
  expect(document.body.textContent).toContain("Total 600");
});

it("drops later taps and restores the last accepted count when a queued command is rejected", async () => {
  const initial: CartView = {
    id: "cart-queued-rejection",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-rejection",
        name: "Queue fruit",
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
  const first = deferred<Response>();
  const second = deferred<Response>();
  const commands: Array<{ quantity: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/serviceability")
        return Response.json({
          ok: true,
          value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
        });
      if (init?.method === "POST") {
        commands.push(JSON.parse(String(init.body)));
        return commands.length === 1 ? first.promise : second.promise;
      }
      return Response.json({ ok: true, value: initial });
    }),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Queue fruit"]')).not.toBeNull(),
  );
  const increase = () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Queue fruit"]')?.click();
  const count = () =>
    document
      .querySelector('[aria-label="Increase Queue fruit"]')
      ?.parentElement?.querySelector("span")?.textContent;
  act(increase);
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  act(() => {
    increase();
    increase();
  });
  expect(count()).toBe("4");
  await act(async () =>
    first.resolve(
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
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]?.quantity).toBe(4);
  await act(async () =>
    second.resolve(
      Response.json({
        ok: false,
        error: { code: "ITEM_UNAVAILABLE", message: "That quantity is unavailable." },
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).toBeNull(),
  );
  expect(count()).toBe("2");
  expect(document.body.textContent).toContain("That quantity is unavailable.");
  expect(document.body.textContent).toContain("Total 200");
  expect(commands).toHaveLength(2);
});

it("keeps a line visible when a queued tap reverses an in-flight removal", async () => {
  const initial: CartView = {
    id: "cart-removal-reversal",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-reversal",
        name: "Reversal fruit",
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
  const first = deferred<Response>();
  const second = deferred<Response>();
  const commands: Array<{ quantity: number; expectedVersion: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/serviceability")
        return Response.json({
          ok: true,
          value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
        });
      if (init?.method === "POST") {
        commands.push(JSON.parse(String(init.body)));
        return commands.length === 1 ? first.promise : second.promise;
      }
      return Response.json({ ok: true, value: initial });
    }),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Decrease Reversal fruit"]')).not.toBeNull(),
  );
  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Decrease Reversal fruit"]')?.click(),
  );
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({ quantity: 0, expectedVersion: 1 });
  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Reversal fruit"]')?.click(),
  );
  expect(
    document.querySelector('[aria-label="Increase Reversal fruit"]')?.parentElement?.textContent,
  ).toContain("1");
  await act(async () =>
    first.resolve(
      Response.json({ ok: true, value: { ...initial, version: 2, items: [], totalMinor: 0 } }),
    ),
  );
  await vi.waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]).toMatchObject({ quantity: 1, expectedVersion: 2 });
  expect(document.body.textContent).toContain("Reversal fruit");
  expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).not.toBeNull();
  await act(async () =>
    second.resolve(Response.json({ ok: true, value: { ...initial, version: 3 } })),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).toBeNull(),
  );
  expect(document.body.textContent).toContain("Reversal fruit");
  expect(document.body.textContent).toContain("Total 100");
});

it("rolls back a rejected quantity preview without hiding the cart", async () => {
  const initial: CartView = {
    id: "cart-rejected-preview",
    locationId: "location-1",
    version: 1,
    currency: "PHP",
    items: [
      {
        skuId: "sku-rejected-preview",
        name: "Rejected fruit",
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
  const response = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      url === "/api/serviceability"
        ? Response.json({
            ok: true,
            value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
          })
        : init?.method === "POST"
          ? response.promise
          : Response.json({ ok: true, value: initial }),
    ),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Decrease Rejected fruit"]')).not.toBeNull(),
  );

  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Decrease Rejected fruit"]')?.click(),
  );
  const stepper = document.querySelector('[aria-label="Decrease Rejected fruit"]')?.parentElement;
  expect(stepper?.querySelector("span")?.textContent).toBe("1");
  await act(async () =>
    response.resolve(
      Response.json({
        ok: false,
        error: { code: "CART_VERSION_CONFLICT", message: "Cart changed. Review it again." },
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"][aria-label="Updating quantity"]')).toBeNull(),
  );
  expect(stepper?.querySelector("span")?.textContent).toBe("2");
  expect(document.body.textContent).toContain("Rejected fruit");
  expect(document.body.textContent).toContain("Cart changed. Review it again.");
});

it("does not offer cart mutations while a retained checkout payment is pending", async () => {
  const pending: CartView = {
    id: "cart-pending",
    locationId: "location-1",
    version: 2,
    currency: "PHP",
    items: [
      {
        skuId: "sku-1",
        name: "Pending fruit",
        quantity: 1,
        unitPriceMinor: 100,
        lineTotalMinor: 100,
        availability: "AVAILABLE",
      },
    ],
    totalMinor: 100,
    paymentInProgress: true,
    checkoutBlocked: false,
    blockingReasons: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json({
        ok: true,
        value:
          url === "/api/serviceability"
            ? { serviceable: true, fulfillmentLocation: { id: "location-1" } }
            : pending,
      }),
    ),
  );
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Increase Pending fruit"]')).not.toBeNull(),
  );
  const cartDialog = document.querySelector<HTMLDialogElement>('[aria-label="Shopping cart"]');
  expect(
    [...(cartDialog?.querySelectorAll("button") ?? [])].some(
      (button) => button.textContent === "Clear All",
    ),
  ).toBe(false);
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Increase Pending fruit"]')?.disabled,
  ).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Decrease Pending fruit"]')?.disabled,
  ).toBe(true);
});

it("confirms before clearing every cart line through one authoritative mutation", async () => {
  let authoritative: CartView = {
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
      {
        skuId: "sku-2",
        name: "Test vegetable",
        quantity: 2,
        unitPriceMinor: 75,
        lineTotalMinor: 150,
        availability: "AVAILABLE",
      },
    ],
    totalMinor: 250,
    checkoutBlocked: false,
    blockingReasons: [],
  };
  const commands: Array<{ cartId: string; expectedVersion: number; idempotencyKey: string }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/serviceability")
      return Response.json({
        ok: true,
        value: { serviceable: true, fulfillmentLocation: { id: "location-1" } },
      });
    if (url === "/api/commerce/cart/clear" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as (typeof commands)[number];
      commands.push(body);
      authoritative = {
        ...authoritative,
        version: authoritative.version + 1,
        items: [],
        totalMinor: 0,
      };
      return Response.json({
        ok: true,
        value: {
          cartId: authoritative.id,
          outcome: "CLEARED",
          clearedLineCount: 2,
          releasedCheckoutAttempts: 0,
          newCartVersion: authoritative.version,
        },
      });
    }
    return Response.json({ ok: true, value: authoritative });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(drawer()));
  await act(async () => window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT)));
  const cartDialog = document.querySelector<HTMLDialogElement>('[aria-label="Shopping cart"]');
  await vi.waitFor(() =>
    expect(
      [...(cartDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].some(
        (button) => button.textContent === "Clear All",
      ),
    ).toBe(true),
  );
  expect(cartDialog?.textContent).toContain("Promo code");
  const promotionInput = cartDialog?.querySelector<HTMLInputElement>(
    'input[aria-label="Promotion code"]',
  );
  if (!promotionInput) throw new Error("Missing compact promotion input");
  await act(async () => {
    promotionInput.value = " save10 ";
    promotionInput.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() =>
    expect(cartDialog?.querySelector('[aria-label="Remove SAVE10 promotion code"]')).not.toBeNull(),
  );
  expect(cartDialog?.textContent).toContain("eligibility pending checkout");

  await act(async () => {
    [...(cartDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Clear All")
      ?.click();
  });
  expect(commands).toHaveLength(0);
  const confirmation = document.querySelector<HTMLDialogElement>(
    '[aria-labelledby="clear-cart-title"]',
  );
  expect(cartDialog?.open).toBe(true);
  await vi.waitFor(() => expect(confirmation?.dataset.state).toBe("open"));
  expect(confirmation?.open).toBe(true);
  expect(confirmation?.textContent).toContain("Clear your cart?");

  await act(async () => {
    [...(confirmation?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Clear All")
      ?.click();
    await vi.waitFor(() => expect(commands).toHaveLength(1));
  });
  expect(commands).toMatchObject([{ cartId: "cart-1", expectedVersion: 1 }]);
  expect(commands[0]?.idempotencyKey).toBeTruthy();
  expect(document.body.textContent).toContain("Your cart is empty");
  expect(confirmation?.open).toBe(false);
});

it.each([false, true])(
  "keeps scroll locked through closing and restores styles (reduced=%s)",
  async (reduced) => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in" } }),
      ),
    );
    document.body.style.overflow = "auto";
    document.body.style.paddingRight = "12px";
    await act(async () => root.render(drawer()));
    await act(async () => {
      window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
    });
    const dialog = document.querySelector("dialog");
    expect(dialog?.open).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => {
      dialog?.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(dialog?.open).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(reduced ? 0 : 240));
    expect(dialog?.open).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.paddingRight).toBe("12px");
  },
);
it("cancels a pending close when the cart is reopened", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in" } }),
    ),
  );
  await act(async () => root.render(drawer()));
  await act(async () => {
    window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
  });
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Close cart"]')?.click(),
  );
  await act(async () => {
    window.dispatchEvent(new Event(CART_DRAWER_REQUEST_EVENT));
  });
  await act(async () => vi.advanceTimersByTimeAsync(240));
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
});
