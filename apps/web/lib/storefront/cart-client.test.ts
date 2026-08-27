import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import {
  CART_CHANGED_EVENT,
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
      { skuId: "sku-a", quantity: 2, name: "Avocado", unitPriceMinor: 9450, lineTotalMinor: 18900 },
      { skuId: "sku-b", quantity: 1, name: "Pechay", unitPriceMinor: 5450, lineTotalMinor: 5450 },
    ],
    totalMinor: 24350,
    currency: "PHP",
    ...overrides,
  };
}

describe("cart view helpers", () => {
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
    stubFetch(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required" } },
      false,
    );
    const result = await addToCart("sku-a", 1);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "unauthenticated");
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
});
