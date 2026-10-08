import { describe, expect, it, vi } from "vitest";
import type { CreateDeliveryRequest, DeliveryRouteRequest } from "../../ports/delivery-provider";
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
      deliveryInstructions: "FreshMarkets Dispatch\nUse the loading entrance",
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
      deliveryInstructions:
        "Unit 4B, Cedar Residences\nBeside the pharmacy\nTell the guard the recipient name\nKeep the vegetables upright\nCall when downstairs",
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

describe("Lalamove shared routes", () => {
  const now = Date.parse("2026-10-08T04:00:00Z");
  function route(): DeliveryRouteRequest {
    return {
      ...request,
      optimize: true,
      destinations: Array.from({ length: 5 }, (_, index) => ({
        reference: `job-${index + 1}`,
        address: {
          ...request.destination,
          formattedAddress: `Synthetic stop ${index + 1}`,
          coordinate: { latitude: 10.3 + index / 100, longitude: 123.9 },
          instructions: { deliveryInstructions: `Instructions ${index + 1}` },
        },
        recipient: {
          ...request.recipient,
          name: `Recipient ${index + 1}`,
          phoneE164: `+63900000000${index + 1}`,
          smsEnabled: false,
        },
      })),
    };
  }
  function provider(fetcher: typeof fetch) {
    return createLalamoveProvider({
      apiKey: "pk_test_fixture",
      apiSecret: "sk_test_fixture",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      now: () => now,
      fetcher,
    });
  }
  function quotes(
    change?: (
      stops: { stopId: string; address: string; coordinates: { lat: string; lng: string } }[],
    ) => void,
  ) {
    return vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        data: { stops: { address: string; coordinates: { lat: string; lng: string } }[] };
      };
      const source = body.data.stops;
      const stops = [source[0]!, source[3]!, source[5]!, source[1]!, source[4]!, source[2]!].map(
        (stop, index) => ({ ...stop, stopId: `stop-${index}` }),
      );
      change?.(stops);
      return Response.json({
        data: {
          quotationId: "accepted-shared-quote",
          expiresAt: new Date(now + 300000).toISOString(),
          isRouteOptimized: true,
          serviceType: "MOTORCYCLE",
          stops,
          priceBreakdown: { total: "71.00", currency: "PHP" },
        },
      });
    });
  }
  it("preserves optimized recipient identities and books the exact reviewed quote without re-quoting", async () => {
    const fetcher = quotes();
    const adapter = provider(fetcher);
    const r = route();
    const quotation = await adapter.quoteRoute!(r);
    expect(quotation).toMatchObject({
      ok: true,
      value: {
        quote: { amountMinor: 7100 },
        stops: [
          { reference: "job-3", stopId: "stop-1", position: 1 },
          { reference: "job-5", stopId: "stop-2", position: 2 },
          { reference: "job-1", stopId: "stop-3", position: 3 },
          { reference: "job-4", stopId: "stop-4", position: 4 },
          { reference: "job-2", stopId: "stop-5", position: 5 },
        ],
      },
    });
    if (!quotation.ok) throw new Error("Missing quotation");
    fetcher.mockResolvedValueOnce(orderResponse());
    expect(
      (
        await adapter.createRoute!({
          route: r,
          quotation: quotation.value,
          merchantOrderId: "fm-shared-fixture",
        })
      ).ok,
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]![0])).toContain("/v3/orders");
    const body = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(body.data.quotationId).toBe("accepted-shared-quote");
    expect(body.data.sender).not.toHaveProperty("remarks");
    expect(
      body.data.recipients.map((r: { name: string; stopId: string; remarks: string }) => [
        r.name,
        r.stopId,
        r.remarks,
      ]),
    ).toEqual([
      ["Recipient 3", "stop-1", "Instructions 3"],
      ["Recipient 5", "stop-2", "Instructions 5"],
      ["Recipient 1", "stop-3", "Instructions 1"],
      ["Recipient 4", "stop-4", "Instructions 4"],
      ["Recipient 2", "stop-5", "Instructions 2"],
    ]);
    expect(body.data).not.toHaveProperty("isSMSNotificationEnabled");
  });
  it("accepts provider decimal rounding while preserving every stop identity", async () => {
    const fetcher = quotes((stops) => {
      for (const stop of stops) stop.coordinates.lat = Number(stop.coordinates.lat).toFixed(7);
    });
    const r = route();
    r.destinations[0]!.address.coordinate.latitude = 10.300000000000001;
    expect(await provider(fetcher).quoteRoute!(r)).toMatchObject({
      ok: true,
      value: { stops: expect.arrayContaining([expect.objectContaining({ reference: "job-1" })]) },
    });
  });
  it.each(["changed destination", "duplicate stop ID", "changed coordinate"])(
    "rejects %s instead of guessing recipient mapping",
    async (kind) => {
      const fetcher = quotes((stops) => {
        if (kind === "changed destination") stops[1]!.address = "Unexpected";
        else if (kind === "changed coordinate")
          stops[1]!.coordinates.lat = String(Number(stops[1]!.coordinates.lat) + 0.00001);
        else stops[1]!.stopId = stops[0]!.stopId;
      });
      expect(await provider(fetcher).quoteRoute!(route())).toMatchObject({
        ok: false,
        error: { code: "LALAMOVE_INVALID_RESPONSE" },
      });
    },
  );
  it("rejects an expired accepted quote before making any create request", async () => {
    const fetcher = quotes();
    const adapter = provider(fetcher);
    const r = route();
    const quote = await adapter.quoteRoute!(r);
    if (!quote.ok) throw new Error("Missing quote");
    expect(
      await adapter.createRoute!({
        route: r,
        merchantOrderId: "fm-shared-fixture",
        quotation: {
          ...quote.value,
          quote: { ...quote.value.quote, expiresAt: new Date(now).toISOString() },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "LALAMOVE_INVALID_REQUEST" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

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
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
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
        providerErrorCode: "ERR_RATE_LIMIT",
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
        evidence: [],
        replacementCheck: false,
        providerDeliveryId: "order-lalamove-1",
        driverId: null,
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
          remarks: request.origin.instructions.deliveryInstructions,
          name: "FreshMarkets Cebu",
          phone: "+639171110000",
        },
        recipients: [
          {
            stopId: "stop-destination",
            name: "Ana Maria Santos",
            phone: "+639171234567",
            remarks:
              "Unit 4B, Cedar Residences\nBeside the pharmacy\nTell the guard the recipient name\nKeep the vegetables upright\nCall when downstairs",
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

  it.each([
    { id: "ERR_INSUFFICIENT_CREDIT", httpStatus: 402 },
    { id: "ERR_PHONE_NUMBER_INVALID", httpStatus: 422 },
    { id: "+639171234567", httpStatus: 422 },
  ])(
    "preserves only safe error IDs in diagnostics for a rejected create: $id",
    async ({ id, httpStatus }) => {
      const events: DeliveryProviderTelemetryEvent[] = [];
      const provider = createLalamoveProvider({
        apiKey: "key-1",
        apiSecret: "secret-1",
        market: "PH",
        language: "en_PH",
        environment: "sandbox",
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(quotationResponse())
          .mockResolvedValueOnce(
            Response.json(
              {
                errors: [
                  {
                    id,
                    message: request.recipient.name,
                    detail: request.destination.formattedAddress,
                  },
                ],
                meta: { requestId: "provider-request-1" },
              },
              { status: httpStatus },
            ),
          ),
        telemetry: { clock: () => 0, sink: (event) => events.push(event) },
      });
      const providerErrorCode = id.startsWith("ERR_") ? { providerErrorCode: id } : {};
      expect(await provider.create(request)).toEqual({
        ok: false,
        providerRequestId: "provider-request-1",
        error: {
          code: `LALAMOVE_HTTP_${httpStatus}`,
          retryable: false,
          outcomeUnknown: false,
          ...providerErrorCode,
        },
      });
      expect(events).toEqual([
        {
          operation: "LALAMOVE_CREATE",
          result: "FAILURE",
          durationMilliseconds: 0,
          errorCode: `LALAMOVE_HTTP_${httpStatus}`,
          providerRequestId: "provider-request-1",
          ...providerErrorCode,
        },
      ]);
      const diagnostics = JSON.stringify(events);
      for (const privateValue of [
        request.recipient.name,
        request.destination.formattedAddress,
        request.recipient.phoneE164,
        "secret-1",
      ])
        expect(diagnostics).not.toContain(privateValue);
    },
  );

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

  it("reads a bounded, signed driver coordinate and rejects invalid provider positions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            driverId: "driver-1",
            name: "Rider One",
            phone: "+63 917 123 4567",
            coordinates: { lat: "10.3173", lng: "123.9058", updatedAt: "2026-09-29T00:00:00.000Z" },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            driverId: "driver-1",
            coordinates: { lat: "91", lng: "123.9058", updatedAt: "2026-09-29T00:00:00.000Z" },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            driverId: "driver-1",
            coordinates: { lat: null, lng: "123.9058", updatedAt: "2026-09-29T00:00:00.000Z" },
          },
        }),
      );
    const provider = createLalamoveProvider({
      apiKey: "key-1",
      apiSecret: "secret-1",
      market: "PH",
      language: "en_PH",
      environment: "sandbox",
      fetcher,
      now: () => 1_725_318_000_000,
      telemetry: { clock: () => 0, sink: () => undefined },
    });
    await expect(provider.getDriverLocation?.("order-1", "driver-1")).resolves.toMatchObject({
      ok: true,
      value: {
        coordinate: { latitude: 10.3173, longitude: 123.9058 },
        contact: { name: "Rider One", phone: "+639171234567" },
      },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v3/orders/order-1/drivers/driver-1");
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    await expect(provider.getDriverLocation?.("order-1", "driver-1")).resolves.toMatchObject({
      ok: false,
      error: { code: "LALAMOVE_INVALID_RESPONSE" },
    });
    await expect(provider.getDriverLocation?.("order-1", "driver-1")).resolves.toMatchObject({
      ok: false,
      error: { code: "LALAMOVE_INVALID_RESPONSE" },
    });
  });
});
