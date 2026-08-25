import { beforeEach, describe, expect, it, vi } from "vitest";

const { commitMockOrder, evaluateCheckout } = vi.hoisted(() => ({
  commitMockOrder: vi.fn(),
  evaluateCheckout: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    ENVIRONMENT: "production",
    PAYMENT_MODE: "sandbox",
    CORE: {
      commitMockOrder,
      evaluateCheckout,
    },
  },
}));

import { GET, POST } from "./route";

function checkoutRequest(body: unknown) {
  return new Request("https://freshmarkets.ph/api/commerce/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "session=x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  commitMockOrder.mockReset();
  evaluateCheckout.mockReset();
});

describe("checkout route containment", () => {
  it("returns HTTP 503 with the stable code and never calls commit outside sandbox", async () => {
    const response = await POST(
      checkoutRequest({
        cartId: "cart-1",
        addressId: "address-1",
        cycleId: "cycle-1",
        commit: true,
        idempotencyKey: "attempt-1",
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(commitMockOrder).not.toHaveBeenCalled();
    expect(evaluateCheckout).not.toHaveBeenCalled();
  });

  it("still proxies evaluation requests without committing", async () => {
    evaluateCheckout.mockResolvedValue({ ok: true, value: { eligible: true } });
    const response = await POST(
      checkoutRequest({ cartId: "cart-1", addressId: "address-1", cycleId: "cycle-1" }),
    );
    expect(response.status).toBe(200);
    expect(commitMockOrder).not.toHaveBeenCalled();
    expect(evaluateCheckout).toHaveBeenCalledTimes(1);
  });

  it("exposes the sandbox capability flag for the checkout experience", async () => {
    const response = await GET(new Request("https://freshmarkets.ph/api/commerce/checkout"));
    const body = (await response.json()) as {
      ok: boolean;
      value: { sandboxPaymentEnabled: boolean };
    };
    expect(body).toEqual({ ok: true, value: { sandboxPaymentEnabled: false } });
  });
});
