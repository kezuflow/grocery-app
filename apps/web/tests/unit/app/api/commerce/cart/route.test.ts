import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setCartItem } = vi.hoisted(() => ({ setCartItem: vi.fn() }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ setCartItem }) }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));

import { POST } from "@/app/api/commerce/cart/route";

const requestId = "ddeb27fb-d9a0-4b8d-8c15-0f765799db42";

function cartPost(body: unknown): Promise<Response> {
  return POST(
    new Request("https://freshmarkets.ph/api/commerce/cart", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        cookie: "session=private-session-value",
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  setCartItem.mockReset();
  setCartItem.mockResolvedValue({ ok: true, value: { id: "cart-1" }, requestId });
});
afterEach(() => vi.restoreAllMocks());

describe("cart command timing", () => {
  it("correlates the Core command and emits only bounded timing data", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await cartPost({
      cartId: "cart-1",
      skuId: "private-sku-id",
      quantity: 1,
      expectedVersion: 1,
      idempotencyKey: "private-idempotency-key",
    });

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("server-timing")).toMatch(/cart_rpc;dur=\d+(?:\.\d+)?/u);
    expect(response.headers.get("server-timing")).toMatch(/cart_web;dur=\d+(?:\.\d+)?/u);
    expect(setCartItem).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, cartId: "cart-1", skuId: "private-sku-id" }),
    );
    const payload = String(logged.mock.calls[0]?.[0]);
    expect(JSON.parse(payload)).toMatchObject({
      event: "cart.web.post",
      requestId,
      result: "success",
      parseMs: expect.any(Number),
      rpcMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(payload).not.toMatch(/private-session-value|private-sku-id|private-idempotency-key/u);
  });

  it("rejects invalid commands without invoking Core", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await cartPost({
      cartId: "cart-1",
      skuId: "sku-1",
      quantity: -1,
      expectedVersion: 1,
      idempotencyKey: "private-idempotency-key",
    });

    expect(response.status).toBe(400);
    expect(setCartItem).not.toHaveBeenCalled();
  });
});
