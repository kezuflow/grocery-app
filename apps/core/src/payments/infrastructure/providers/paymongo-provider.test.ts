import { describe, expect, it } from "vitest";
import { PayMongoProvider } from "./paymongo-provider";
import { buildProviderRegistry } from "./runtime-providers";

const SECRET = "sk_test_secret";
const WEBHOOK_SECRET = "whsec_test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function signatureParts(secret: string, timestampSeconds: number, rawBody: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestampSeconds}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestampSeconds},te=${hex}`;
}

function paymentEvent(type: string): string {
  return JSON.stringify({
    data: {
      id: `evt_${type}`,
      type,
      attributes: {
        data: { id: "pay_123", attributes: { amount: 29900, currency: "php" } },
      },
    },
  });
}

const provider = new PayMongoProvider({
  secretKey: SECRET,
  webhookSecretTest: WEBHOOK_SECRET,
});

describe("PayMongoProvider.verifyAndParseEvent", () => {
  it("accepts a correctly signed payment.paid event and maps canonical state", async () => {
    const rawBody = paymentEvent("payment.paid");
    const seconds = Math.floor(Date.now() / 1000);
    const headers = new Headers({
      "paymongo-signature": await signatureParts(WEBHOOK_SECRET, seconds, rawBody),
    });
    const result = await provider.verifyAndParseEvent(headers, rawBody);
    if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
    expect(result.event.canonicalState).toBe("SUCCEEDED");
    expect(result.event.kind).toBe("payment");
    expect(result.event.providerEventId).toBe("evt_payment.paid");
    expect(result.event.providerReference).toBe("pay_123");
    expect(result.event.amountMinor).toBe(29900);
    expect(result.event.currency).toBe("PHP");
    expect(result.event.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a tampered payload, stale timestamps, and unknown types", async () => {
    const seconds = Math.floor(Date.now() / 1000);
    const rawBody = paymentEvent("payment.paid");
    const good = await signatureParts(WEBHOOK_SECRET, seconds, rawBody);
    const tampered = await provider.verifyAndParseEvent(
      new Headers({ "paymongo-signature": good }),
      `${rawBody} `,
    );
    expect(tampered.ok).toBe(false);
    const stale = await signatureParts(WEBHOOK_SECRET, seconds - 3600, rawBody);
    expect(
      (await provider.verifyAndParseEvent(new Headers({ "paymongo-signature": stale }), rawBody))
        .ok,
    ).toBe(false);
    const unknownType = JSON.stringify({ data: { id: "evt_x", type: "payment.weird" } });
    const signedUnknown = await signatureParts(WEBHOOK_SECRET, seconds, unknownType);
    const unknown = await provider.verifyAndParseEvent(
      new Headers({ "paymongo-signature": signedUnknown }),
      unknownType,
    );
    expect(unknown.ok ? unknown.event.kind : unknown.reason).toBe("UNKNOWN_EVENT_TYPE");
  });

  it("maps refund events with their refund reference", async () => {
    const rawBody = JSON.stringify({
      data: {
        id: "evt_refund",
        type: "refund.paid",
        attributes: { data: { id: "ref_9", attributes: { amount: 5000, currency: "PHP" } } },
      },
    });
    const seconds = Math.floor(Date.now() / 1000);
    const headers = new Headers({
      "paymongo-signature": await signatureParts(WEBHOOK_SECRET, seconds, rawBody),
    });
    const result = await provider.verifyAndParseEvent(headers, rawBody);
    if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
    expect(result.event.kind).toBe("refund");
    expect(result.event.refundReference).toBe("ref_9");
    expect(result.event.canonicalState).toBe("SUCCEEDED");
  });
});

describe("PayMongoProvider HTTP operations", () => {
  it("creates a checkout session with basic auth and idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, {
        data: { id: "cs_1", attributes: { checkout_url: "https://checkout.example/pay" } },
      });
    }) as typeof fetch;
    const adapted = new PayMongoProvider({ secretKey: SECRET }, fetchImpl);
    const result = await adapted.createPayment({
      providerCustomerId: null,
      amountMinor: 29900,
      currency: "PHP",
      returnUrl: "https://app.example/return",
      idempotencyKey: "idem-1",
    });
    if (!result.ok) throw new Error(`unexpected error ${result.errorCode}`);
    expect(result.actionType).toBe("REDIRECT");
    expect(result.redirectUrl).toBe("https://checkout.example/pay");
    expect(calls[0].url).toContain("/v1/checkout_sessions");
    const headers = new Headers(calls[0].init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe(`Basic ${btoa(`${SECRET}:`)}`);
    expect(headers.get("idempotency-key")).toBe("idem-1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.data.attributes.amount).toBe(29900);
    expect(body.data.attributes.reference_number).toBe("idem-1");
  });

  it("maps provider http failures to stable error codes", async () => {
    const fetchImpl = (async () => jsonResponse(402, { errors: [] })) as typeof fetch;
    const adapted = new PayMongoProvider({ secretKey: SECRET }, fetchImpl);
    const result = await adapted.createPayment({
      providerCustomerId: null,
      amountMinor: 100,
      currency: "PHP",
      returnUrl: "https://app.example/return",
      idempotencyKey: "idem-2",
    });
    expect(result).toEqual({ ok: false, errorCode: "PROVIDER_HTTP_402" });
  });

  it("requests refunds with an idempotency key and returns the reference", async () => {
    const calls: Array<RequestInit> = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return jsonResponse(200, { data: { id: "ref_5" } });
    }) as typeof fetch;
    const adapted = new PayMongoProvider({ secretKey: SECRET }, fetchImpl);
    const result = await adapted.requestRefund({
      providerReference: "pay_123",
      refundProviderIdempotencyKey: "refund-key-1",
      amountMinor: 5000,
      currency: "PHP",
    });
    expect(result.ok && result.providerRefundReference === "ref_5").toBe(true);
    expect(new Headers(calls[0].headers as HeadersInit).get("idempotency-key")).toBe(
      "refund-key-1",
    );
  });

  it("resolves session references through the checkout-session fallback lookup", async () => {
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("/payments/")) return jsonResponse(404, { errors: [] });
      return jsonResponse(200, {
        data: {
          id: "cs_1",
          attributes: { status: "succeeded", paid_at: 123, amount: 29900, currency: "PHP" },
        },
      });
    }) as typeof fetch;
    const adapted = new PayMongoProvider({ secretKey: SECRET }, fetchImpl);
    const view = await adapted.getPayment("cs_1");
    expect(view?.canonicalState).toBe("SUCCEEDED");
    expect(view?.amountMinor).toBe(29900);
  });
});

describe("buildProviderRegistry", () => {
  it("registers paymongo only when configured and stays fail-closed otherwise", () => {
    const configured = buildProviderRegistry({
      ENVIRONMENT: "production",
      PAYMONGO_SECRET_KEY: SECRET,
      PAYMONGO_WEBHOOK_SECRET_TEST: WEBHOOK_SECRET,
    });
    expect(configured.get("paymongo")?.code).toBe("paymongo");

    const unconfigured = buildProviderRegistry({ ENVIRONMENT: "production" });
    expect(unconfigured.get("paymongo")).toBeNull();
    expect(() => unconfigured.require("paymongo")).toThrow(/PAYMENT_PROVIDER_UNCONFIGURED/);
  });
});
