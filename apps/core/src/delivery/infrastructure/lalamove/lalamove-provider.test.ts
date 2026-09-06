import { describe, expect, it, vi } from "vitest";
import type { CreateDeliveryRequest } from "../../ports/delivery-provider";
import type { DeliveryProviderTelemetryEvent } from "../delivery-provider-telemetry";
import { createLalamoveProvider } from "./lalamove-provider";

const request: CreateDeliveryRequest = {
  merchantOrderId: "FM-1001",
  serviceType: "MOTORCYCLE",
  currencyCode: "PHP",
  currencyExponent: 2,
  packages: [
    {
      kind: "BAG",
      name: "Fresh produce order",
      description: "Packed grocery tote",
      quantity: 1,
      priceMinor: 12_550,
      weightGrams: 4_000,
    },
  ],
  sender: {
    name: "FreshMarkets Cebu",
    phoneE164: "+639171110000",
    email: "dispatch@freshmarkets.ph",
    smsEnabled: false,
  },
  recipient: {
    name: "Ana Maria Santos",
    phoneE164: "+639171234567",
    email: null,
    smsEnabled: true,
  },
  origin: {
    formattedAddress: "FreshMarkets Hub, Cebu City, Cebu, Philippines",
    coordinate: { latitude: 10.3157, longitude: 123.8854 },
    components: {
      addressLine1: "FreshMarkets Hub",
      addressLine2: null,
      barangay: "Luz",
      city: "Cebu City",
      region: "Central Visayas",
      postalCode: "6000",
      countryCode: "PH",
    },
    instructions: {
      buildingUnit: "FreshMarkets Dispatch",
      landmark: null,
      gateGuard: "Use the loading entrance",
      deliveryNote: null,
      recipientInstruction: null,
    },
  },
  destination: {
    formattedAddress: "Unit 4B, 1 Private Street, Cebu City, Cebu, Philippines",
    coordinate: { latitude: 10.317331, longitude: 123.905812 },
    components: {
      addressLine1: "1 Private Street",
      addressLine2: "Unit 4B",
      barangay: "Kasambagan",
      city: "Cebu City",
      region: "Central Visayas",
      postalCode: "6000",
      countryCode: "PH",
    },
    instructions: {
      buildingUnit: "Unit 4B, Cedar Residences",
      landmark: "Beside the pharmacy",
      gateGuard: "Tell the guard the recipient name",
      deliveryNote: "Keep the vegetables upright",
      recipientInstruction: "Call when downstairs",
    },
  },
  schedule: null,
};

function quotationResponse() {
  return Response.json(
    {
      data: {
        quotationId: "quote-1",
        expiresAt: "2026-09-03T02:05:00.000Z",
        serviceType: "MOTORCYCLE",
        language: "en_PH",
        stops: [{ stopId: "stop-origin" }, { stopId: "stop-destination" }],
        priceBreakdown: { total: "149.50", currency: "PHP" },
        distance: { value: "8.2", unit: "km" },
      },
    },
    { headers: { "Request-ID": "lalamove-quote-request" } },
  );
}

function orderResponse() {
  return Response.json(
    {
      data: {
        orderId: "order-lalamove-1",
        status: "ASSIGNING_DRIVER",
        shareLink: "https://share.lalamove.com/order-lalamove-1",
      },
    },
    { headers: { "Request-ID": "lalamove-order-request" } },
  );
}

async function expectedSignature(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

describe("Lalamove delivery adapter", () => {
  it("signs the exact v3 request and maps a quotation to integer minor units", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quotationResponse());
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => 1_725_318_000_000,
      requestId: () => "nonce-1",
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.quote(request)).resolves.toEqual({
      ok: true,
      providerRequestId: "lalamove-quote-request",
      value: [
        {
          providerQuotationId: "quote-1",
          serviceType: "MOTORCYCLE",
          amountMinor: 14_950,
          currency: "PHP",
          expiresAt: "2026-09-03T02:05:00.000Z",
          estimatedPickupAt: null,
          estimatedDropoffAt: null,
          distanceMeters: 8_200,
        },
      ],
    });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://rest.sandbox.lalamove.com/v3/quotations");
    const body = String(init?.body);
    expect(JSON.parse(body)).toEqual({
      data: {
        serviceType: "MOTORCYCLE",
        language: "en_PH",
        stops: [
          {
            coordinates: { lat: "10.3157", lng: "123.8854" },
            address: "FreshMarkets Hub, Cebu City, Cebu, Philippines",
          },
          {
            coordinates: { lat: "10.317331", lng: "123.905812" },
            address: "Unit 4B, 1 Private Street, Cebu City, Cebu, Philippines",
          },
        ],
      },
    });
    const signature = await expectedSignature(
      "secret-1",
      `1725318000000\r\nPOST\r\n/v3/quotations\r\n\r\n${body}`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`hmac key-1:1725318000000:${signature}`);
    expect(headers.get("market")).toBe("PH");
    expect(headers.get("request-id")).toBe("nonce-1");
  });

  it("omits scheduleAt for immediate dispatch and sends the operator pickup time when scheduled", async () => {
    const now = 1_725_318_000_000;
    const pickupFrom = new Date(now + 60_000).toISOString();
    const pickupTo = new Date(now + 30 * 60_000).toISOString();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quotationResponse());
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => now,
      requestId: () => "nonce-1",
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await provider.quote({ ...request, schedule: { pickupFrom, pickupTo } });
    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      data: Record<string, unknown>;
    };
    expect(payload.data.scheduleAt).toBe(pickupFrom);
    expect(payload.data).not.toHaveProperty("item");
  });

  it("rejects a scheduled pickup beyond Lalamove's 30-day horizon", async () => {
    const now = 1_725_318_000_000;
    const fetcher = vi.fn<typeof fetch>();
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => now,
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(
      provider.quote({
        ...request,
        schedule: {
          pickupFrom: new Date(now + 31 * 24 * 60 * 60 * 1_000).toISOString(),
          pickupTo: new Date(now + 31 * 24 * 60 * 60 * 1_000 + 60_000).toISOString(),
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "LALAMOVE_INVALID_REQUEST", retryable: false, outcomeUnknown: false },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("declares verified capabilities and retains rate-limit backoff", async () => {
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher: vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json(
          { errors: [{ id: "ERR_RATE_LIMIT" }] },
          { status: 429, headers: { "Retry-After": "3", "Request-ID": "rate-limit-1" } },
        ),
      ),
      now: () => 1_725_318_000_000,
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    expect(provider.capabilities).toEqual({
      immediateQuotation: true,
      scheduledQuotation: {
        supported: true,
        maximumAdvanceMilliseconds: 30 * 24 * 60 * 60 * 1_000,
      },
      createDelivery: true,
      retrieveDelivery: true,
      cancelDelivery: true,
      signedStatusWebhooks: true,
      requiresPackageDimensions: false,
    });
    await expect(provider.quote(request)).resolves.toEqual({
      ok: false,
      providerRequestId: "rate-limit-1",
      error: {
        code: "LALAMOVE_HTTP_429",
        retryable: true,
        outcomeUnknown: false,
        retryAfterMilliseconds: 3_000,
      },
    });
  });

  it("quotes immediately before create and carries the selected stops and merchant metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(quotationResponse())
      .mockResolvedValueOnce(orderResponse());
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => 1_725_318_000_000,
      requestId: () => "nonce-1",
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.create(request)).resolves.toEqual({
      ok: true,
      providerRequestId: "lalamove-order-request",
      value: {
        providerDeliveryId: "order-lalamove-1",
        merchantOrderId: "FM-1001",
        status: "ALLOCATING",
        trackingUrl: "https://share.lalamove.com/order-lalamove-1",
        pickupPin: null,
        quote: {
          providerQuotationId: "quote-1",
          serviceType: "MOTORCYCLE",
          amountMinor: 14_950,
          currency: "PHP",
          expiresAt: "2026-09-03T02:05:00.000Z",
          estimatedPickupAt: null,
          estimatedDropoffAt: null,
          distanceMeters: 8_200,
        },
      },
    });

    const payload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toEqual({
      data: {
        quotationId: "quote-1",
        sender: {
          stopId: "stop-origin",
          name: "FreshMarkets Cebu",
          phone: "+639171110000",
        },
        recipients: [
          {
            stopId: "stop-destination",
            name: "Ana Maria Santos",
            phone: "+639171234567",
            remarks:
              "Package: 1 bag\r\nBuilding/unit: Unit 4B, Cedar Residences\r\nLandmark: Beside the pharmacy\r\nGate/guard: Tell the guard the recipient name\r\nDelivery note: Keep the vegetables upright\r\nRecipient instruction: Call when downstairs",
          },
        ],
        isPODEnabled: true,
        metadata: { merchantOrderId: "FM-1001" },
      },
    });
    const serializedRequests = fetcher.mock.calls
      .map(([, init]) => String(init?.body ?? ""))
      .join("\n");
    for (const excludedOption of [
      "THERMAL_BAG_1",
      "CASH_ON_DELIVERY",
      "CASH_ON_DELIVERY_AUTODEDUCT",
      "PURCHASE_SERVICE",
    ])
      expect(serializedRequests).not.toContain(excludedOption);
  });

  it("marks an interrupted order create as unknown and emits customer-data-free telemetry", async () => {
    const events: DeliveryProviderTelemetryEvent[] = [];
    let time = 0;
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(quotationResponse())
        .mockRejectedValueOnce(new Error("connection reset")),
      now: () => 1_725_318_000_000,
      requestId: () => "nonce-1",
      telemetry: { clock: () => (time += 9), sink: (event) => events.push(event) },
    });

    await expect(provider.create(request)).resolves.toEqual({
      ok: false,
      error: { code: "LALAMOVE_OUTCOME_UNKNOWN", retryable: true, outcomeUnknown: true },
    });
    expect(events).toEqual([
      {
        operation: "LALAMOVE_CREATE",
        result: "FAILURE",
        durationMilliseconds: 9,
        errorCode: "LALAMOVE_OUTCOME_UNKNOWN",
      },
    ]);
    const diagnostics = JSON.stringify(events);
    for (const value of [
      request.recipient.name,
      request.recipient.phoneE164,
      request.destination.formattedAddress,
      "secret-1",
    ])
      expect(diagnostics).not.toContain(value);
  });

  it("maps Lalamove lifecycle states and signs bodyless GET and DELETE requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            orderId: "order-lalamove-1",
            status: "PICKED_UP",
            shareLink: "https://share.lalamove.com/order-lalamove-1",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: {} }));
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => 1_725_318_000_000,
      requestId: () => "nonce-1",
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.get("order-lalamove-1")).resolves.toMatchObject({
      ok: true,
      value: { status: "IN_DELIVERY", merchantOrderId: null },
    });
    await expect(provider.cancel("order-lalamove-1")).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(fetcher.mock.calls[1]?.[1]?.body).toBeUndefined();
  });
});
