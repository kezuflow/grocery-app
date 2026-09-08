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

describe("PayMongo refund outcome certainty", () => {
  const request = {
    providerReference: "pi_refund",
    refundProviderIdempotencyKey: "stable-refund-key",
    amountMinor: 500,
    currency: "PHP",
  };
  function captured() {
    return Response.json({
      data: {
        id: "pi_refund",
        type: "payment_intent",
        attributes: {
          status: "succeeded",
          amount: 1000,
          currency: "PHP",
          payments: [{ id: "pay_refund", attributes: { status: "paid" } }],
        },
      },
    });
  }
  it.each(["timeout", "server", "invalid-json", "invalid-resource"])(
    "keeps %s after submission unknown",
    async (kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(captured());
      if (kind === "timeout") fetcher.mockRejectedValueOnce(new Error("TEST_NETWORK_LOSS"));
      if (kind === "server")
        fetcher.mockResolvedValueOnce(
          Response.json({ errors: [{ code: "server_error" }] }, { status: 500 }),
        );
      if (kind === "invalid-json") fetcher.mockResolvedValueOnce(new Response("unreadable"));
      if (kind === "invalid-resource") fetcher.mockResolvedValueOnce(Response.json({ data: {} }));
      await expect(provider(fetcher).requestRefund(request)).rejects.toThrow(
        "PAYMONGO_REFUND_OUTCOME_UNKNOWN",
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[1][0]).endsWith("/v1/refunds")).toBe(true);
    },
  );
  it("distinguishes an explicit rejection from an accepted identity", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(captured())
      .mockResolvedValueOnce(
        Response.json({ errors: [{ code: "payment_not_refundable" }] }, { status: 422 }),
      );
    expect(await provider(fetcher).requestRefund(request)).toMatchObject({ ok: false });
    fetcher.mockResolvedValueOnce(captured()).mockResolvedValueOnce(
      Response.json({
        data: { id: "ref_accepted", type: "refund", attributes: { status: "pending" } },
      }),
    );
    expect(await provider(fetcher).requestRefund(request)).toEqual({
      ok: true,
      providerRefundReference: "ref_accepted",
    });
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toMatchObject({
      data: {
        attributes: {
          payment_id: "pay_refund",
          amount: 500,
          metadata: { freshmarkets_refund_key: "stable-refund-key" },
        },
      },
    });
  });
});

describe("PayMongo read-only Refund lookup", () => {
  const input = {
    providerReference: "pi_lookup",
    providerRefundReference: null,
    refundProviderIdempotencyKey: "lookup-key",
  };
  function payment() {
    return Response.json({
      data: {
        id: "pi_lookup",
        type: "payment_intent",
        attributes: {
          status: "succeeded",
          amount: 20000,
          currency: "PHP",
          payments: [{ id: "pay_lookup", attributes: { status: "paid" } }],
        },
      },
    });
  }
  function refund(
    id = "ref_lookup",
    status = "succeeded",
    key = "lookup-key",
    paymentId = "pay_lookup",
  ) {
    return {
      id,
      type: "refund",
      attributes: {
        payment_id: paymentId,
        amount: 5000,
        currency: "PHP",
        status,
        metadata: { freshmarkets_refund_key: key },
      },
    };
  }
  it.each(["pending", "processing", "succeeded", "failed"])(
    "normalizes known %s evidence with payment identity",
    async (state) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(payment())
        .mockResolvedValueOnce(Response.json({ data: refund("ref_lookup", state) }));
      expect(
        await provider(fetcher).lookupRefund?.({ ...input, providerRefundReference: "ref_lookup" }),
      ).toMatchObject({
        outcome: "FOUND",
        refund: {
          providerReference: "pi_lookup",
          providerRefundReference: "ref_lookup",
          amountMinor: 5000,
          currency: "PHP",
          canonicalState:
            state === "succeeded" ? "SUCCEEDED" : state === "failed" ? "FAILED" : "PROCESSING",
        },
      });
      expect(String(fetcher.mock.calls[1][0])).toBe(
        "https://api.paymongo.com/v1/refunds/ref_lookup",
      );
      for (const call of fetcher.mock.calls) expect(call[1]?.method ?? "GET").toBe("GET");
    },
  );
  it("finds a lost response by exact metadata through bounded payment-scoped pages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(payment())
      .mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 20 }, (_, index) =>
            refund(`ref_${index}`, "succeeded", `unrelated-${index}`),
          ),
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: [refund()], has_more: false }));
    expect(await provider(fetcher).lookupRefund?.(input)).toMatchObject({
      outcome: "FOUND",
      refund: { providerRefundReference: "ref_lookup", idempotencyKey: "lookup-key" },
    });
    const url = new URL(String(fetcher.mock.calls[2][0]));
    expect(url.searchParams.get("data.attributes.payment_id")).toBe("pay_lookup");
    expect(url.searchParams.get("data.attributes.after")).toBe("ref_19");
    expect(url.searchParams.get("data.attributes.limit")).toBe("20");
  });
  it.each(["missing", "duplicate", "wrong-payment", "wrong-key", "unavailable"])(
    "keeps %s evidence unresolved without posting",
    async (kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(payment());
      if (kind === "unavailable") fetcher.mockRejectedValueOnce(new Error("TEST_LOOKUP_TIMEOUT"));
      else if (kind === "wrong-key")
        fetcher.mockResolvedValueOnce(
          Response.json({ data: refund("ref_lookup", "succeeded", "different-key") }),
        );
      else
        fetcher.mockResolvedValueOnce(
          Response.json({
            data:
              kind === "missing"
                ? []
                : kind === "duplicate"
                  ? [refund(), refund("second-ref")]
                  : [refund("ref_lookup", "succeeded", "lookup-key", "different-payment")],
            has_more: false,
          }),
        );
      const result = await provider(fetcher).lookupRefund?.({
        ...input,
        providerRefundReference: kind === "wrong-key" ? "ref_lookup" : null,
      });
      expect(result).toEqual({
        outcome: "UNRESOLVED",
        reason:
          kind === "missing"
            ? "NOT_FOUND"
            : kind === "duplicate"
              ? "AMBIGUOUS"
              : kind === "unavailable"
                ? "UNAVAILABLE"
                : "MISMATCH",
      });
      for (const call of fetcher.mock.calls) expect(call[1]?.method ?? "GET").toBe("GET");
    },
  );
  it("stops after three pages and does not infer absence from truncation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(payment());
    for (let page = 0; page < 3; page++)
      fetcher.mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 20 }, (_, index) =>
            refund(`ref_${page}_${index}`, "succeeded", `other-${page}-${index}`),
          ),
          has_more: true,
        }),
      );
    expect(await provider(fetcher).lookupRefund?.(input)).toEqual({
      outcome: "UNRESOLVED",
      reason: "SEARCH_LIMIT",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
