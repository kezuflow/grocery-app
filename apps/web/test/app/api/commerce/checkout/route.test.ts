import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateCheckout } = vi.hoisted(() => ({ evaluateCheckout: vi.fn() }));

vi.mock("cloudflare:workers", () => ({
  env: {
    ENVIRONMENT: "production",
    CORE: { evaluateCheckout },
  },
}));

import { POST } from "@/app/api/commerce/checkout/route";

function checkoutRequest(body: unknown) {
  return new Request("https://freshmarkets.ph/api/commerce/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "session=x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  evaluateCheckout.mockReset();
});

describe("checkout route containment", () => {
  it("retires the mock commitment path with HTTP 410 in every environment", async () => {
    const response = await POST(
      checkoutRequest({
        cartId: "cart-1",
        addressId: "address-1",
        cycleId: "cycle-1",
        commit: true,
        idempotencyKey: "attempt-1",
      }),
    );
    expect(response.status).toBe(410);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(evaluateCheckout).not.toHaveBeenCalled();
  });

  it("still proxies evaluation requests without committing", async () => {
    evaluateCheckout.mockResolvedValue({ ok: true, value: { eligible: true } });
    const response = await POST(
      checkoutRequest({ cartId: "cart-1", addressId: "address-1", cycleId: "cycle-1" }),
    );
    expect(response.status).toBe(200);
    expect(evaluateCheckout).toHaveBeenCalledTimes(1);
  });
});
