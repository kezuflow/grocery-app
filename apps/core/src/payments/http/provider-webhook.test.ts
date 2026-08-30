import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("provider webhook route", () => {
  it("fails closed with PAYMENT_PROVIDER_UNCONFIGURED for an unregistered provider", async () => {
    // The automated harness runs as the test environment, where the mock
    // adapter registers through the runtime construction point; an
    // unregistered code proves the fail-closed webhook path.
    const response = await SELF.fetch(
      "https://core.example.invalid/webhooks/payments/never-registered",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-signature": "x",
          "x-mock-timestamp": "0",
        },
        body: "{}",
      },
    );
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

  it("rejects oversized and unsupported bodies before provider lookup", async () => {
    const oversized = await SELF.fetch(
      "https://core.example.invalid/webhooks/payments/never-registered",
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "262145" },
        body: "{}",
      },
    );
    expect(oversized.status).toBe(413);
    const unsupported = await SELF.fetch(
      "https://core.example.invalid/webhooks/payments/never-registered",
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      },
    );
    expect(unsupported.status).toBe(415);
  });
});
