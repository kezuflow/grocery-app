import { describe, expect, it, vi } from "vitest";
const listFulfillmentOptions = vi.fn().mockResolvedValue({ ok: true, value: [] });
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ listFulfillmentOptions }) }));
import { POST } from "@/app/api/checkout/fulfillment-options/route";
describe("fulfillment options route", () => {
  it("forwards only version-bound address and cart identity", async () => {
    const response = await POST(
      new Request("https://x/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          addressId: "address-1",
          addressVersion: 2,
          cartId: "cart-1",
          cartVersion: 4,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(listFulfillmentOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        addressId: "address-1",
        addressVersion: 2,
        cartId: "cart-1",
        cartVersion: 4,
      }),
    );
  });
});
