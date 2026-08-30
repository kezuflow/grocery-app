import { describe, expect, it, vi } from "vitest";
const createAmendmentPaymentIntent = vi.fn().mockResolvedValue({ ok: true, value: {} });
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({ coreClient: () => ({ createAmendmentPaymentIntent }) }));
vi.mock("@/lib/core-client/commands", () => ({ requireIdempotencyKey: () => "payment-key" }));
import { POST } from "./route";

describe("amendment payment route", () => {
  it("forwards the explicitly accepted separate total", async () => {
    const response = await POST(
      new Request("https://x/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedAmendmentVersion: 1,
          expectedCurrency: "PHP",
          expectedTotalMinor: 16000,
          returnUrl: "https://freshmarkets.ph/orders/order-1",
        }),
      }),
      { params: Promise.resolve({ "amendment-id": "amendment-1" }) },
    );
    expect(response.status).toBe(200);
    expect(createAmendmentPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amendmentId: "amendment-1",
        expectedTotalMinor: 16000,
        idempotencyKey: "payment-key",
      }),
    );
  });
});
