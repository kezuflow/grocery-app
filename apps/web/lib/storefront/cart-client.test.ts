import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import {
  CART_CHANGED_EVENT,
  CART_DRAWER_REQUEST_EVENT,
  addToCart,
  cartCountFromView,
  fetchCart,
  quantityForSku,
} from "./cart-client";

function view(overrides: Partial<CartView> = {}): CartView {
  return {
    id: "cart-1",
    version: 2,
    items: [
      { skuId: "sku-a", quantity: 2, name: "Avocado", availability: "AVAILABLE", unitPriceMinor: 9450, lineTotalMinor: 18900 },
      { skuId: "sku-b", quantity: 1, name: "Pechay", availability: "AVAILABLE", unitPriceMinor: 5450, lineTotalMinor: 5450 },
    ],
    totalMinor: 24350,
    currency: "PHP",
    checkoutBlocked: false,
    blockingReasons: [],
    ...overrides,
  };
}

describe("cart view helpers", () => {
  it("exposes a stable event for opening the storefront cart drawer", () => {
    assert.equal(CART_DRAWER_REQUEST_EVENT, "fm:cart-drawer-request");
  });

  it("sums item quantities into the cart count", () => {
    assert.equal(cartCountFromView(view()), 3);
    assert.equal(cartCountFromView(view({ items: [] })), 0);
  });

  it("finds a sku quantity and defaults to zero", () => {
    assert.equal(quantityForSku(view(), "sku-a"), 2);
    assert.equal(quantityForSku(view(), "missing"), 0);
  });
});

describe("addToCart", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, ok: boolean) {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 401 })),
    );
    return dispatch;
  }

  it("broadcasts the new cart count on success", async () => {
    const dispatch = stubFetch({ ok: true, value: view() }, true);
    const result = await addToCart("sku-a", 3);
    assert.deepEqual(result, { ok: true, count: 3 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.mock.calls[0]?.[0] as CustomEvent | undefined;
    assert.equal(dispatched?.type, CART_CHANGED_EVENT);
  });

  it("classifies UNAUTHENTICATED failures", async () => {
    const storage = {
      value: null as string | null,
      getItem: () => storage.value,
      setItem: (_key: string, value: string) => {
        storage.value = value;
      },
      removeItem: () => {
        storage.value = null;
      },
      clear: () => {
        storage.value = null;
      },
    } as unknown as Storage;
    const dispatch = stubFetch(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required" } },
      false,
    );
    vi.stubGlobal("window", { dispatchEvent: dispatch, localStorage: storage });
    const result = await addToCart("sku-a", 1, {
      name: "Avocado",
      unitPriceMinor: 9450,
      currency: "PHP",
    });
    assert.deepEqual(result, { ok: true, count: 1, requiresSignIn: true });
    assert.equal(JSON.parse(storage.value ?? "{}").items[0].skuId, "sku-a");
  });

  it("reports fetch failures as generic errors", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await addToCart("sku-a", 1);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "error");
  });
});

describe("fetchCart", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the view on success", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, value: view() }))),
    );
    assert.equal((await fetchCart())?.id, "cart-1");
  });

  it("returns null for anonymous visitors and failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHENTICATED" } })),
      ),
    );
    assert.equal(await fetchCart(), null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    assert.equal(await fetchCart(), null);
  });

  it("merges a saved guest cart after authentication succeeds", async () => {
    const storage = {
      value: JSON.stringify({
        version: 1,
        items: [
          {
            skuId: "sku-a",
            quantity: 2,
            name: "Avocado",
            unitPriceMinor: 9450,
            currency: "PHP",
            lineTotalMinor: 18900,
          },
        ],
      }),
      getItem: () => storage.value,
      setItem: (_key: string, value: string) => {
        storage.value = value;
      },
      removeItem: () => {
        storage.value = null;
      },
    } as unknown as Storage;
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), localStorage: storage });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: true,
            value: view({
              items: [
                {
                  skuId: "sku-a",
                  quantity: 2,
                  name: "Avocado",
                  availability: "AVAILABLE",
                  unitPriceMinor: 9450,
                  lineTotalMinor: 18900,
                },
              ],
            }),
          }),
        );
      }
      return new Response(JSON.stringify({ ok: true, value: view({ items: [] }) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchCart();
    assert.equal(result?.items[0]?.skuId, "sku-a");
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(storage.value, null);
  });
});
