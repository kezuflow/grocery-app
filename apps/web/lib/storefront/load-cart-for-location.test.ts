import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCartForLocation } from "./load-cart-for-location";
import { BROWSING_LOCATION_COOKIE, parseBrowsingPoint } from "./browsing-location";

let saved: Map<string, string>;
const point = { latitude: 10.32, longitude: 123.9 };
const response = (value: unknown) => new Response(JSON.stringify(value));
const resolution = {
  ok: true,
  value: { serviceable: true, fulfillmentLocation: { id: "site-1", name: "Selected site" } },
};
const current = { ok: true, value: { id: "cart-1", locationId: "site-1", version: 1, items: [] } };
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal("document", {
    cookie: `${BROWSING_LOCATION_COOKIE}=${encodeURIComponent(JSON.stringify(point))}`,
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("requires a selected point and rejects malformed or out-of-range remembered data", async () => {
  vi.stubGlobal("document", { cookie: "" });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await loadCartForLocation()).toMatchObject({
    ok: false,
    error: { code: "DELIVERY_LOCATION_REQUIRED" },
  });
  expect(fetchMock).not.toHaveBeenCalled();
  for (const value of [
    undefined,
    "invalid",
    encodeURIComponent('{"latitude":91,"longitude":123}'),
    encodeURIComponent('{"latitude":"10","longitude":123}'),
  ])
    expect(parseBrowsingPoint(value)).toBeNull();
  expect(parseBrowsingPoint(encodeURIComponent(JSON.stringify(point)))).toEqual(point);
});
it("resolves coordinates and creates the first Cart through its explicit command", async () => {
  let selected = false;
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/serviceability") {
        expect(JSON.parse(String(init?.body))).toEqual(point);
        return response(resolution);
      }
      if (url === "/api/commerce/cart/location") {
        selected = true;
        bodies.push(JSON.parse(String(init?.body)));
        return response({
          ok: true,
          value: { cartId: "cart-1", version: 1, locationId: "site-1" },
        });
      }
      return response(
        selected ? current : { ok: false, error: { code: "DELIVERY_LOCATION_REQUIRED" } },
      );
    }),
  );
  expect(await loadCartForLocation()).toEqual(current);
  expect(bodies).toEqual([
    expect.objectContaining({ ...point, expectedVersion: 0, idempotencyKey: expect.any(String) }),
  ]);
  expect(saved.size).toBe(0);
});
it("replays an uncertain location command even when the next read already shows its selected site", async () => {
  let selected = false;
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === "/api/serviceability") return response(resolution);
      if (url === "/api/commerce/cart/location") {
        bodies.push(String(init?.body));
        if (!selected) {
          selected = true;
          throw new Error("response lost");
        }
        return response({
          ok: true,
          value: { cartId: "cart-1", version: 1, locationId: "site-1" },
        });
      }
      return response(
        selected ? current : { ok: false, error: { code: "DELIVERY_LOCATION_REQUIRED" } },
      );
    }),
  );
  await expect(loadCartForLocation()).rejects.toThrow("response lost");
  expect(saved.size).toBe(1);
  expect(await loadCartForLocation()).toEqual(current);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(saved.size).toBe(0);
});
it("does not substitute a default site for coordinates outside serviceability", async () => {
  const fetchMock = vi.fn(async () =>
    response({ ok: true, value: { serviceable: false, fulfillmentLocation: null } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await loadCartForLocation()).toMatchObject({
    ok: false,
    error: { code: "DELIVERY_LOCATION_REQUIRED" },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(saved.size).toBe(0);
});
