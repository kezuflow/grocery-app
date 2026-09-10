import { afterEach, expect, it, vi } from "vitest";
import { readJson, READ_TIMEOUT_MS } from "./read-deadline";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("bounds a stalled body as well as stalled response headers", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      signal = init.signal;
      return { json: () => new Promise(() => {}) };
    }),
  );
  const result = readJson("/api/catalog");
  const rejected = expect(result).rejects.toThrow("Loading took too long");
  await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("cleans up the deadline after a successful read", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
  expect(await readJson("/api/catalog")).toEqual({ ok: true });
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves typed HTTP failures but rejects a conflicting success body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
    ),
  );
  expect(await readJson("/api/commerce/cart")).toMatchObject({
    ok: false,
    error: { code: "UNAUTHENTICATED" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true }, { status: 500 })),
  );
  await expect(readJson("/api/catalog")).rejects.toThrow("could not be loaded");
});
