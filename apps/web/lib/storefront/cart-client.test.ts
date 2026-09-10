import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import {
  CART_CHANGED_EVENT,
  CART_DRAWER_REQUEST_EVENT,
  addToCart,
  cartCountFromView,
  fetchCart,
  quantityForSku,
  clearGuestCart,
  cartLoadError,
  refreshCartForLocation,
  cachedCart,
} from "./cart-client";

// Location-command behavior is exercised separately against its real fetch sequence.
vi.mock("./load-cart-for-location", () => ({
  loadCartForLocation: async () => (await fetch("/api/commerce/cart")).json(),
  requestDeliveryLocation: vi.fn(),
}));
const guestKey = "freshmarkets.guest-cart.v1",
  pendingKey = "freshmarkets.guest-cart-merge.v1";
let saved: Map<string, string>;
let dispatch: ReturnType<typeof vi.fn>;
function view(overrides: Partial<CartView> = {}): CartView {
  return {
    id: "cart-1",
    locationId: "location-1",
    version: 2,
    items: [
      {
        skuId: "sku-a",
        quantity: 2,
        name: "Avocado",
        availability: "AVAILABLE",
        unitPriceMinor: 9450,
        lineTotalMinor: 18900,
      },
      {
        skuId: "sku-b",
        quantity: 1,
        name: "Pechay",
        availability: "AVAILABLE",
        unitPriceMinor: 5450,
        lineTotalMinor: 5450,
      },
    ],
    totalMinor: 24350,
    currency: "PHP",
    checkoutBlocked: false,
    blockingReasons: [],
    ...overrides,
  };
}
function saveGuest() {
  saved.set(
    guestKey,
    JSON.stringify({
      version: 1,
      transferId: "one-guest-selection",
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
  );
}
const response = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  saved = new Map();
  dispatch = vi.fn();
  vi.stubGlobal("window", {
    dispatchEvent: dispatch,
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    },
  });
  clearGuestCart();
});
afterEach(() => vi.unstubAllGlobals());

describe("cart view helpers", () => {
  it("exposes a stable cart drawer event", () =>
    assert.equal(CART_DRAWER_REQUEST_EVENT, "fm:cart-drawer-request"));
  it("sums quantities and handles an empty Cart", () => {
    assert.equal(cartCountFromView(view()), 3);
    assert.equal(cartCountFromView(view({ items: [] })), 0);
  });
  it("finds a SKU quantity without inventing a missing line", () => {
    assert.equal(quantityForSku(view(), "sku-a"), 2);
    assert.equal(quantityForSku(view(), "missing"), 0);
  });
});
describe("addToCart", () => {
  it("retains canonical guest image URLs and rejects tampered remote images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: false, error: { code: "UNAUTHENTICATED" } })),
    );
    const media = { src: "/media/products/image-1/2", alt: "Fresh avocado" };
    expect(
      await addToCart("sku-media", 1, {
        name: "Avocado",
        unitPriceMinor: 100,
        currency: "PHP",
        media,
      }),
    ).toMatchObject({ ok: true });
    expect((await fetchCart())?.items[0]?.media).toEqual(media);
    saved.set(
      guestKey,
      JSON.stringify({
        items: [
          {
            skuId: "sku-media",
            quantity: 1,
            name: "Avocado",
            unitPriceMinor: 100,
            currency: "PHP",
            media: { src: "https://outside.invalid/tracker", alt: "Unsafe image" },
          },
        ],
      }),
    );
    expect((await fetchCart())?.items[0]?.media).toBeNull();
  });
  it("broadcasts the authoritative count on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: true, value: view() })),
    );
    expect(await addToCart("sku-a", 3)).toEqual({ ok: true, view: view(), count: 3 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].type).toBe(CART_CHANGED_EVENT);
  });
  it("keeps anonymous items for sign-in with a distinct transfer identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in" } }),
      ),
    );
    expect(
      await addToCart("sku-a", 1, { name: "Avocado", unitPriceMinor: 9450, currency: "PHP" }),
    ).toMatchObject({ ok: true, view: { id: "guest-cart" }, count: 1, requiresSignIn: true });
    const first = JSON.parse(saved.get(guestKey)!);
    expect(first.items[0].skuId).toBe("sku-a");
    await addToCart("sku-a", 2, { name: "Avocado", unitPriceMinor: 9450, currency: "PHP" });
    expect(JSON.parse(saved.get(guestKey)!).transferId).not.toBe(first.transferId);
  });
  it("reports fetch failure without claiming a mutation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await addToCart("sku-a", 1)).toMatchObject({ ok: false, reason: "error" });
  });
});
describe("fetchCart", () => {
  it("returns the authoritative view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: true, value: view() })),
    );
    expect((await fetchCart())?.id).toBe("cart-1");
  });
  it("returns null for anonymous empty carts and exposes a retryable transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: false, error: { code: "UNAUTHENTICATED" } })),
    );
    expect(await fetchCart()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchCart()).toBeNull();
    expect(cartLoadError()).toBe("offline");
  });
  it("merges all guest lines in one command and uses the following current Cart read", async () => {
    saveGuest();
    let quantity = 3;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.items).toEqual([{ skuId: "sku-a", quantity: 2 }]);
        quantity += 2;
        return response({ ok: true, value: { cartId: "cart-1", version: 3 } });
      }
      return response({
        ok: true,
        value: view({
          items: [
            { ...view().items[0]!, quantity, unitPriceMinor: 100, lineTotalMinor: quantity * 100 },
          ],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [first, concurrent] = await Promise.all([fetchCart(), fetchCart()]);
    expect(first).toEqual(concurrent);
    expect(first?.items[0]).toMatchObject({
      quantity: 5,
      unitPriceMinor: 100,
      lineTotalMinor: 500,
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(saved.has(guestKey)).toBe(false);
    expect(saved.has(pendingKey)).toBe(false);
  });
  it("replays the same merge after a lost success response without duplicating existing quantities", async () => {
    saveGuest();
    let quantity = 3;
    const commands: string[] = [];
    const applied = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const raw = String(init.body),
            body = JSON.parse(raw);
          commands.push(raw);
          if (!applied.has(body.idempotencyKey)) {
            applied.add(body.idempotencyKey);
            quantity += 2;
            throw new Error("response lost");
          }
          return response({ ok: true, value: { cartId: "cart-1", version: 3 } });
        }
        return response({
          ok: true,
          value: view({
            version: applied.size ? 3 : 2,
            items: [{ ...view().items[0]!, quantity }],
          }),
        });
      }),
    );
    expect((await fetchCart())?.checkoutBlocked).toBe(true);
    expect(saved.has(guestKey)).toBe(true);
    expect(saved.has(pendingKey)).toBe(true);
    expect((await fetchCart())?.items[0]?.quantity).toBe(5);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toBe(commands[0]);
    expect(applied.size).toBe(1);
    expect(saved.has(guestKey)).toBe(false);
  });
  it("keeps rejected guest data visible for review and permits removal before retry", async () => {
    saveGuest();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? response({
              ok: false,
              error: { code: "NOT_FOUND", message: "Saved item no longer exists" },
            })
          : response({ ok: true, value: view({ items: [] }) }),
      ),
    );
    expect((await fetchCart())?.checkoutBlocked).toBe(true);
    expect(saved.has(guestKey)).toBe(true);
    expect(saved.has(pendingKey)).toBe(false);
    expect(await addToCart("sku-a", 0)).toMatchObject({ ok: true, count: 0 });
    expect(saved.has(guestKey)).toBe(false);
  });
});

it("discards an old location read and serializes the fresh cart behind it", async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response({ ok: true, value: view({ locationId: "location-2" }) }));
  vi.stubGlobal("fetch", fetcher);
  const old = fetchCart();
  await Promise.resolve();
  const refreshed = refreshCartForLocation();
  expect(cachedCart()).toBeNull();
  expect(fetchCart()).toBe(refreshed);
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(response({ ok: true, value: view() }));
  expect(await old).toBeNull();
  expect((await refreshed)?.locationId).toBe("location-2");
  expect(cachedCart()?.locationId).toBe("location-2");
  const published = dispatch.mock.calls.map(([event]) => event.detail.view).filter(Boolean);
  expect(published).toHaveLength(1);
  expect(published[0].locationId).toBe("location-2");
});
