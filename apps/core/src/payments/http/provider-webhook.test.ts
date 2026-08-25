import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("provider webhook route", () => {
  it("fails closed with PAYMENT_PROVIDER_UNCONFIGURED while no production adapter is selected", async () => {
    const response = await SELF.fetch("https://core.example.invalid/webhooks/payments/fake", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fake-signature": "x",
        "x-fake-timestamp": "0",
      },
      body: "{}",
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PAYMENT_PROVIDER_UNCONFIGURED");
  });

  it("returns not found for non-matching paths and methods", async () => {
    const wrongPath = await SELF.fetch("https://core.example.invalid/webhooks/payments/", {
      method: "POST",
      body: "{}",
    });
    expect(wrongPath.status).toBe(404);
    const wrongMethod = await SELF.fetch("https://core.example.invalid/webhooks/payments/stripe");
    expect(wrongMethod.status).toBe(404);
  });
});
