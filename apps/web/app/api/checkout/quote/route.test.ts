import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCheckoutQuote } = vi.hoisted(() => ({
  createCheckoutQuote: vi.fn(),
}));
const requireIdempotencyKey = vi.fn();

vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ createCheckoutQuote }),
}));
vi.mock("@/lib/core-client/request", () => ({
  requestHeaders: () => ({ cookie: "s=1" }),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { POST } from "./route";

function post(body: unknown, key?: string) {
  return POST(
    new Request("https://freshmarkets.ph/api/checkout/quote", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  createCheckoutQuote.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("checkout quote route", () => {
  it("forwards the client's stable idempotency key to Core", async () => {
    requireIdempotencyKey.mockReturnValue("stable-key");
    createCheckoutQuote.mockResolvedValue({ ok: true, value: { quoteId: "q1" }, requestId: "r" });
    const response = await post({
      cartId: "c1",
      cartVersion: 2,
      addressId: "a1",
      cycleId: "cy1",
    });
    expect(response.status).toBe(200);
    const forwarded = createCheckoutQuote.mock.calls[0][0];
    expect(forwarded.idempotencyKey).toBe("stable-key");
    expect(forwarded.cartVersion).toBe(2);
  });

  it("rejects a missing idempotency key with 400 before calling Core", async () => {
    requireIdempotencyKey.mockImplementation(() => {
      throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    });
    const response = await post({ cartId: "c1", cartVersion: 1, addressId: "a", cycleId: "y" });
    expect(response.status).toBe(400);
    expect(createCheckoutQuote).not.toHaveBeenCalled();
  });
});
