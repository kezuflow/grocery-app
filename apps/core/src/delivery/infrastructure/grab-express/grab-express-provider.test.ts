import { describe, expect, it, vi } from "vitest";
import type { CreateDeliveryRequest } from "../../ports/delivery-provider";
import type { DeliveryProviderTelemetryEvent } from "../delivery-provider-telemetry";
import { createGrabExpressProvider } from "./grab-express-provider";

const request: CreateDeliveryRequest = {
  merchantOrderId: "order-1001",
  serviceType: "INSTANT",
  currencyCode: "PHP",
  currencyExponent: 2,
  packages: [
    {
      name: "Fresh produce order",
      description: "Packed grocery tote",
      quantity: 1,
      priceMinor: 12_550,
      heightCentimeters: 30,
      widthCentimeters: 25,
      depthCentimeters: 20,
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

function tokenResponse() {
  return Response.json({
    access_token: "grab-access-token",
    token_type: "Bearer",
    expires_in: 900,
  });
}

function createResponse() {
  return Response.json(
    {
      deliveryID: "PH-DELIVERY-1",
      merchantOrderID: request.merchantOrderId,
      quote: {
        service: { id: 0, type: "INSTANT", name: "GrabExpress" },
        currency: { code: "PHP", symbol: "₱", exponent: 2 },
        amount: 149.5,
        estimatedTimeline: {
          pickup: "2026-09-03T02:00:00Z",
          dropoff: "2026-09-03T02:45:00Z",
        },
        distance: 8_200,
      },
      status: "ALLOCATING",
      trackingURL: "https://grab.example/track/PH-DELIVERY-1",
      pickupPin: "2354",
    },
    { headers: { "x-grabkit-grab-requestid": "grab-request-1" } },
  );
}

function quoteResponse() {
  return Response.json({
    quotes: [
      {
        service: { type: "INSTANT" },
        currency: { code: "PHP", exponent: 2 },
        amount: 149.5,
        estimatedTimeline: null,
        distance: 8_200,
      },
    ],
  });
}

describe("GrabExpress delivery adapter", () => {
  it("sends the required customer, exact destination, instruction, and package data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(createResponse());
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher,
    });

    await expect(provider.create(request)).resolves.toEqual({
      ok: true,
      providerRequestId: "grab-request-1",
      value: {
        providerDeliveryId: "PH-DELIVERY-1",
        merchantOrderId: "order-1001",
        status: "ALLOCATING",
        trackingUrl: "https://grab.example/track/PH-DELIVERY-1",
        pickupPin: "2354",
        quote: {
          serviceType: "INSTANT",
          amountMinor: 14_950,
          currency: "PHP",
          estimatedPickupAt: "2026-09-03T02:00:00Z",
          estimatedDropoffAt: "2026-09-03T02:45:00Z",
          distanceMeters: 8_200,
        },
      },
    });

    const [, deliveryInit] = fetcher.mock.calls[1]!;
    const payload = JSON.parse(String(deliveryInit?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      merchantOrderID: "order-1001",
      serviceType: "INSTANT",
      paymentMethod: "CASHLESS",
      payer: "SENDER",
      recipient: {
        firstName: "Ana",
        lastName: "Maria Santos",
        phone: "639171234567",
        smsEnabled: true,
        instruction:
          "Unit 4B, Cedar Residences; Beside the pharmacy; Tell the guard the recipient name; Keep the vegetables upright; Call when downstairs",
      },
      destination: {
        address: "Unit 4B, 1 Private Street, Cebu City, Cebu, Philippines",
        keywords: "Unit 4B, Cedar Residences",
        coordinates: { latitude: 10.317331, longitude: 123.905812 },
      },
      packages: [
        {
          name: "Fresh produce order",
          description: "Packed grocery tote",
          quantity: 1,
          price: 125.5,
          dimensions: { height: 30, width: 25, depth: 20, weight: 4_000 },
        },
      ],
    });
    expect(payload).not.toHaveProperty("destination.cityCode");
  });

  it("keeps diagnostics useful without putting customer delivery data into telemetry", async () => {
    const events: DeliveryProviderTelemetryEvent[] = [];
    let time = 0;
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(null, {
            status: 400,
            headers: { "x-grabkit-grab-requestid": "grab-request-failed" },
          }),
        ),
      telemetry: {
        clock: () => (time += 12),
        sink: (event) => events.push(event),
      },
    });

    await expect(provider.create(request)).resolves.toEqual({
      ok: false,
      error: { code: "GRAB_HTTP_400", retryable: false, outcomeUnknown: false },
      providerRequestId: "grab-request-failed",
    });
    expect(events).toEqual([
      {
        operation: "GRAB_EXPRESS_CREATE",
        result: "FAILURE",
        durationMilliseconds: 12,
        errorCode: "GRAB_HTTP_400",
        providerRequestId: "grab-request-failed",
      },
    ]);
    const diagnostics = JSON.stringify(events);
    for (const customerValue of [
      request.recipient.name,
      request.recipient.phoneE164,
      request.destination.formattedAddress,
      request.destination.instructions.deliveryNote,
      String(request.destination.coordinate.latitude),
      "client-secret",
      "grab-access-token",
    ]) {
      expect(diagnostics).not.toContain(customerValue);
    }
  });

  it("marks an interrupted create as unknown so callers reconcile instead of retrying blindly", async () => {
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(tokenResponse())
        .mockRejectedValueOnce(new Error("connection reset after request write")),
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.create(request)).resolves.toEqual({
      ok: false,
      error: { code: "GRAB_OUTCOME_UNKNOWN", retryable: true, outcomeUnknown: true },
    });
  });

  it("rejects placeholder parcel measurements before calling Grab", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher,
      telemetry: { clock: () => 0, sink: () => undefined },
    });
    const invalidRequest: CreateDeliveryRequest = {
      ...request,
      packages: [{ ...request.packages[0]!, weightGrams: 0 }],
    };

    await expect(provider.create(invalidRequest)).resolves.toEqual({
      ok: false,
      error: { code: "GRAB_INVALID_REQUEST", retryable: false, outcomeUnknown: false },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("quotes with coordinates and converts Grab's exponent-based amount to integer minor units", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(quoteResponse());
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher,
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.quote(request)).resolves.toMatchObject({
      ok: true,
      value: [{ amountMinor: 14_950, currency: "PHP", distanceMeters: 8_200 }],
    });
  });

  it("reuses an unexpired OAuth token and refreshes it once after a 401", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(quoteResponse())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ access_token: "fresh-token", token_type: "Bearer", expires_in: 900 }),
      )
      .mockResolvedValueOnce(quoteResponse());
    const provider = createGrabExpressProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      fetcher,
      now: () => 1_000,
      telemetry: { clock: () => 0, sink: () => undefined },
    });

    await expect(provider.quote(request)).resolves.toMatchObject({ ok: true });
    await expect(provider.quote(request)).resolves.toMatchObject({ ok: true });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/grabid/v1/oauth2/token");
    expect(String(fetcher.mock.calls[3]?.[0])).toContain("/grabid/v1/oauth2/token");
    const retryHeaders = new Headers(fetcher.mock.calls[4]?.[1]?.headers);
    expect(retryHeaders.get("authorization")).toBe("Bearer fresh-token");
  });
});
