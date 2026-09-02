import { describe, expect, it, vi } from "vitest";
import { createPayMongoPaymentProvider } from "./paymongo-payment-provider";

const NOW = 1_800_000_000_000;
const WEBHOOK_SECRET = "whsk_test_freshmarkets";

async function signature(rawBody: string): Promise<string> {
  const timestamp = Math.floor(NOW / 1000).toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  const hex = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `t=${timestamp},te=${hex},li=`;
}

function provider(fetcher: typeof fetch = vi.fn()) {
  return createPayMongoPaymentProvider({
    secretKey: "sk_test_freshmarkets",
    webhookSecret: WEBHOOK_SECRET,
    now: () => NOW,
    fetcher,
  });
}

describe("PayMongo payment provider", () => {
  it("verifies exact raw payloads and maps unpaid subscription observations", async () => {
    const rawBody = JSON.stringify({
      data: {
        id: "evt_unpaid_1",
        type: "event",
        attributes: {
          type: "subscription.unpaid",
          livemode: false,
          created_at: NOW / 1000,
          data: {
            id: "subs_1",
            type: "subscription",
            attributes: {
              customer_id: "cus_1",
              plan_id: "plan_1",
              payment_method_id: "pm_1",
              status: "unpaid",
              next_billing_schedule: "2027-01-01",
            },
          },
        },
      },
    });
    const headers = new Headers({ "paymongo-signature": await signature(rawBody) });
    await expect(provider().verifyAndParseEvent(headers, rawBody)).resolves.toMatchObject({
      ok: true,
      event: {
        provider: "paymongo",
        providerEventId: "evt_unpaid_1",
        eventType: "subscription.unpaid",
        kind: "subscription",
        providerReference: "subs_1",
        providerStatus: "UNPAID",
        providerCustomerReference: "cus_1",
        providerPlanReference: "plan_1",
      },
    });
    await expect(
      provider().verifyAndParseEvent(
        new Headers({ "paymongo-signature": await signature(`${rawBody} `) }),
        rawBody,
      ),
    ).resolves.toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("uses Basic auth and PayMongo idempotency for payment intent creation", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Basic ${btoa("sk_test_freshmarkets:")}`);
      expect(headers.get("idempotency-key")).toBe("payment-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        data: { attributes: { amount: 25000, currency: "PHP" } },
      });
      return Response.json({
        data: {
          id: "pi_1",
          type: "payment_intent",
          attributes: { client_key: "pi_1_client_secret", status: "awaiting_payment_method" },
        },
      });
    }) as typeof fetch;
    await expect(
      provider(fetcher).createPayment({
        providerCustomerId: null,
        amountMinor: 25000,
        currency: "PHP",
        returnUrl: "https://freshmarkets.example/payments/return",
        idempotencyKey: "payment-key",
      }),
    ).resolves.toMatchObject({
      ok: true,
      providerReference: "pi_1",
      actionType: "SDK",
      clientToken: "pi_1_client_secret",
    });
  });

  it("creates an immutable scheduled monthly plan", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        data: {
          attributes: {
            plan_type: "scheduled",
            amount: 19900,
            currency: "PHP",
            interval: "monthly",
            interval_count: 1,
          },
        },
      });
      return Response.json({ data: { id: "plan_1", type: "plan", attributes: {} } });
    }) as typeof fetch;
    const result = await provider(fetcher).ensureSubscriptionPlan?.({
      priceVersionId: "price-v1",
      name: "FreshMarkets Membership",
      description: "Monthly membership",
      amountMinor: 19900,
      currency: "PHP",
      existingProviderPlanReference: null,
      idempotencyKey: "fm-plan-price-v1",
    });
    expect(result).toEqual({ ok: true, providerPlanReference: "plan_1" });
  });
});
