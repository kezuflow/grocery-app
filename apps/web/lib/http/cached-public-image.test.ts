import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cachedPublicImage } from "./cached-public-image";

let stored: Map<string, Response>;
const origin = vi.fn(() =>
  Promise.resolve(
    new Response("image bytes", { headers: { etag: '"v1"', "content-type": "image/webp" } }),
  ),
);
beforeEach(() => {
  stored = new Map();
  origin.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (key: Request) => stored.get(key.url)?.clone(),
      put: async (key: Request, response: Response) => {
        stored.set(key.url, response.clone());
      },
    }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const request = (suffix = "", headers = {}) =>
  new Request(`https://freshmarkets.test/media/products/image/1${suffix}`, { headers });
it("reuses public image bytes across queries and visitors without a second origin read", async () => {
  await cachedPublicImage(request("?first=1", { cookie: "session=a" }), origin);
  const response = await cachedPublicImage(request("?second=2", { cookie: "session=b" }), origin);
  expect(await response.text()).toBe("image bytes");
  expect(origin).toHaveBeenCalledTimes(1);
  expect(response.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");
});
it("honors weak/list ETags from cache and preserves age without extending freshness", async () => {
  await cachedPublicImage(request(), origin);
  vi.advanceTimersByTime(120_000);
  const response = await cachedPublicImage(
    request("", { "if-none-match": '"other", W/"v1"' }),
    origin,
  );
  expect(response.status).toBe(304);
  expect(response.headers.get("age")).toBe("120");
  expect(origin).toHaveBeenCalledTimes(1);
});
it("rechecks origin after expiration and never caches a removal", async () => {
  await cachedPublicImage(request(), origin);
  vi.advanceTimersByTime(300_000);
  const removed = vi.fn(
    async () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } }),
  );
  expect((await cachedPublicImage(request(), removed)).status).toBe(404);
  expect((await cachedPublicImage(request(), removed)).status).toBe(404);
  expect(removed).toHaveBeenCalledTimes(2);
});
it("does not reuse cached images for a different version", async () => {
  await cachedPublicImage(request(), origin);
  await cachedPublicImage(new Request("https://freshmarkets.test/media/products/image/2"), origin);
  expect(origin).toHaveBeenCalledTimes(2);
});
it("serves successful origin bytes if caching fails", async () => {
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async () => {
        throw new Error("offline");
      },
      put: async () => {
        throw new Error("offline");
      },
    }),
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await (await cachedPublicImage(request(), origin)).text()).toBe("image bytes");
  expect(warning).toHaveBeenCalledWith("PUBLIC_IMAGE_CACHE_WRITE_FAILED");
  warning.mockRestore();
});
