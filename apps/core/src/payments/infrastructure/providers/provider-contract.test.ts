import { describe, expect, it } from "vitest";
import { createMockPaymentProvider, mockSignatureFor } from "./mock-payment-provider";

const provider = createMockPaymentProvider();

function eventHeaders(rawBody: string, timestamp = Date.now()) {
  return new Headers({
    "x-mock-signature": "placeholder",
    "x-mock-timestamp": String(timestamp),
  });
}

async function signedRequest(body: Record<string, unknown>, timestamp = Date.now()) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: new Headers({
      "x-mock-signature": await mockSignatureFor(rawBody),
      "x-mock-timestamp": String(timestamp),
    }),
  };
}

describe("mock payment provider contract", () => {
  it("creates redirect actions without canonical success states", async () => {
    const result = await provider.createPayment({
      providerCustomerId: null,
      amountMinor: 29900,
      currency: "PHP",
      returnUrl: "https://app.example/return",
      idempotencyKey: `contract-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionType).toBe("REDIRECT");
    expect(result.redirectUrl).toBeTruthy();
  });

  it("verifies signed events and rejects tampered or stale ingress", async () => {
    const body = {
      eventId: `evt-${crypto.randomUUID()}`,
      reference: "mock_pay_ref-1",
      vendorState: "paid",
      amountMinor: 29900,
      currency: "PHP",
    };
    const signed = await signedRequest(body);
    const verified = await provider.verifyAndParseEvent(signed.headers, signed.rawBody);
    expect(verified).toMatchObject({ ok: true, event: { canonicalState: "SUCCEEDED" } });

    const tampered = await provider.verifyAndParseEvent(
      eventHeaders(JSON.stringify(body)),
      JSON.stringify({ ...body, vendorState: "pending" }),
    );
    expect(tampered).toMatchObject({ ok: false, reason: "INVALID_SIGNATURE" });

    const stale = await signedRequest(body, Date.now() - 10 * 60 * 1000);
    const staleResult = await provider.verifyAndParseEvent(stale.headers, stale.rawBody);
    expect(staleResult).toMatchObject({ ok: false, reason: "INVALID_TIMESTAMP" });
  });

  it("rejects unparseable payloads and unknown vendor states after signature verification", async () => {
    const garbage = "not-json";
    const garbageHeaders = new Headers({
      "x-mock-signature": await mockSignatureFor(garbage),
      "x-mock-timestamp": String(Date.now()),
    });
    const unparseable = await provider.verifyAndParseEvent(garbageHeaders, garbage);
    expect(unparseable).toMatchObject({ ok: false, reason: "UNPARSEABLE_PAYLOAD" });

    const unknownBody = {
      eventId: `evt-${crypto.randomUUID()}`,
      reference: "mock_pay_ref-2",
      vendorState: "mysterious",
      amountMinor: 100,
      currency: "PHP",
    };
    const unknownSigned = await signedRequest(unknownBody);
    const unknown = await provider.verifyAndParseEvent(
      unknownSigned.headers,
      unknownSigned.rawBody,
    );
    expect(unknown).toMatchObject({ ok: false, reason: "UNKNOWN_EVENT_TYPE" });
  });

  it("requests refunds with stable references", async () => {
    const refund = await provider.requestRefund({
      providerReference: "mock_pay_ref-1",
      refundProviderIdempotencyKey: `refund-${crypto.randomUUID()}`,
      amountMinor: 29900,
      currency: "PHP",
    });
    expect(refund).toMatchObject({ ok: true });
  });
});
