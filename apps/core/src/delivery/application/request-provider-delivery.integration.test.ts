import { seedTestInstantOrder } from "../../test-commerce-fixtures";
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type {
  CreateDeliveryRequest,
  DeliveryProvider,
  DeliveryProviderResult,
  ProviderDelivery,
} from "../ports/delivery-provider";
import { requestProviderDelivery } from "./request-provider-delivery";
import { applyProviderObservation } from "./apply-provider-observation";

function request(merchantOrderId: string): CreateDeliveryRequest {
  const address = {
    formattedAddress: "1 Test Street, Cebu City, Philippines",
    coordinate: { latitude: 10.3157, longitude: 123.8854 },
    components: {
      addressLine1: "1 Test Street",
      addressLine2: null,
      barangay: "Luz",
      city: "Cebu City",
      region: "Central Visayas",
      postalCode: "6000",
      countryCode: "PH",
    },
    instructions: {
      buildingUnit: null,
      landmark: null,
      gateGuard: null,
      deliveryNote: null,
      recipientInstruction: null,
    },
  } as const;
  return {
    merchantOrderId,
    serviceType: "INSTANT",
    currencyCode: "PHP",
    currencyExponent: 2,
    packages: [
      {
        kind: "BAG",
        name: "Grocery tote",
        description: "Packed FreshMarkets grocery order",
        quantity: 1,
        heightCentimeters: 30,
        widthCentimeters: 25,
        depthCentimeters: 20,
        weightGrams: 3_000,
        priceMinor: 10_000,
      },
    ],
    sender: {
      name: "FreshMarkets Cebu",
      phoneE164: "+639171110000",
      email: null,
      smsEnabled: false,
    },
    recipient: {
      name: "Ana Santos",
      phoneE164: "+639171234567",
      email: null,
      smsEnabled: true,
    },
    origin: address,
    destination: address,
    schedule: null,
  };
}

async function deliveryJob(id: string): Promise<void> {
  await seedTestInstantOrder(env.DB, `order-${id}`);
  await env.DB.prepare(
    `INSERT INTO delivery_job
     (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, status,
      context_resolution_status, address_snapshot_json, version, created_at, updated_at)
     VALUES (?, ?, NULL, 'INSTANT', 'location-cebu-central',
             'zone-cebu-city-core', 'UNASSIGNED', 'RESOLVED', '{}', 1, 1, 1)`,
  )
    .bind(id, `order-${id}`)
    .run();
}

function provider(
  result: DeliveryProviderResult<ProviderDelivery>,
): DeliveryProvider & { create: ReturnType<typeof vi.fn<DeliveryProvider["create"]>> } {
  return {
    code: "grab-express",
    capabilities: {
      immediateQuotation: true,
      scheduledQuotation: { supported: false, maximumAdvanceMilliseconds: null },
      createDelivery: true,
      retrieveDelivery: true,
      cancelDelivery: true,
      signedStatusWebhooks: false,
      requiresPackageDimensions: true,
    },
    quote: vi.fn(),
    create: vi.fn(async () => result),
    get: vi.fn(),
    cancel: vi.fn(),
  };
}

describe("requestProviderDelivery", () => {
  it("keeps failed attempts, blocks uncertain replacements and quarantines late observations from an older attempt", async () => {
    const id = `job-history-${crypto.randomUUID()}`;
    await deliveryJob(id);
    const grab = provider({
      ok: false,
      error: { code: "PROVIDER_REJECTED", retryable: false, outcomeUnknown: false },
    });
    const firstRequest = request(`merchant-first-${id}`);
    await requestProviderDelivery(env.DB, grab, {
      requestId: "first",
      deliveryJobId: id,
      request: firstRequest,
    });
    const old = await env.DB.prepare(
      "SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=?",
    )
      .bind(id)
      .first<{ id: string }>();
    if (!old) throw new Error("Missing failed attempt");
    grab.create.mockResolvedValue({
      ok: false,
      error: { code: "TIMEOUT", retryable: false, outcomeUnknown: true },
    });
    const second = request(`merchant-second-${id}`);
    await requestProviderDelivery(env.DB, grab, {
      requestId: "second",
      deliveryJobId: id,
      request: second,
    });
    const rows = await env.DB.prepare(
      "SELECT status,merchant_order_id,attempt_sequence FROM delivery_provider_dispatch WHERE delivery_job_id=? ORDER BY attempt_sequence",
    )
      .bind(id)
      .all();
    expect(rows.results).toEqual([
      { status: "FAILED", merchant_order_id: firstRequest.merchantOrderId, attempt_sequence: 1 },
      { status: "OUTCOME_UNKNOWN", merchant_order_id: second.merchantOrderId, attempt_sequence: 2 },
    ]);
    await requestProviderDelivery(env.DB, grab, {
      requestId: "third",
      deliveryJobId: id,
      request: request(`merchant-third-${id}`),
    });
    expect(grab.create).toHaveBeenCalledTimes(2);
    const before = await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
      .bind(id)
      .first();
    expect(
      await applyProviderObservation(env.DB, {
        dispatchId: old.id,
        observedAt: Date.now(),
        status: "PENDING_PICKUP",
        trackingUrl: null,
      }),
    ).toEqual({ outcome: "RECONCILIATION_REQUIRED", reason: "DELIVERY_ATTEMPT_SUPERSEDED" });
    expect(
      await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?").bind(id).first(),
    ).toEqual(before);
  });
  it("persists one booking and returns it on an exact replay without calling Grab twice", async () => {
    const id = `job-provider-${crypto.randomUUID()}`;
    await deliveryJob(id);
    const input = request(`merchant-${id}`);
    const grab = provider({
      ok: true,
      value: {
        providerDeliveryId: `grab-${id}`,
        merchantOrderId: input.merchantOrderId,
        status: "ALLOCATING",
        trackingUrl: "https://grab.example/tracking/1",
        pickupPin: "1234",
        quote: {
          providerQuotationId: null,
          serviceType: "INSTANT",
          amountMinor: 15_000,
          currency: "PHP",
          expiresAt: null,
          estimatedPickupAt: null,
          estimatedDropoffAt: null,
          distanceMeters: 5_000,
        },
      },
    });

    const command = {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      request: input,
    };
    const created = await requestProviderDelivery(env.DB, grab, command);
    const replay = await requestProviderDelivery(env.DB, grab, {
      ...command,
      requestId: crypto.randomUUID(),
    });

    expect(created).toMatchObject({
      ok: true,
      value: {
        status: "ACTIVE",
        providerDeliveryId: `grab-${id}`,
        providerStatus: "ALLOCATING",
        attemptCount: 1,
      },
    });
    expect(replay).toMatchObject({ ok: true, value: { status: "ACTIVE", attemptCount: 1 } });
    expect(grab.create).toHaveBeenCalledOnce();
  });

  it("parks an uncertain create outcome and refuses a blind retry", async () => {
    const id = `job-unknown-${crypto.randomUUID()}`;
    await deliveryJob(id);
    const input = request(`merchant-${id}`);
    const grab = provider({
      ok: false,
      error: { code: "GRAB_OUTCOME_UNKNOWN", retryable: true, outcomeUnknown: true },
    });

    const first = await requestProviderDelivery(env.DB, grab, {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      request: input,
    });
    const second = await requestProviderDelivery(env.DB, grab, {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      request: input,
    });

    expect(first).toMatchObject({
      ok: false,
      error: { code: "DELIVERY_RECONCILIATION_REQUIRED" },
    });
    expect(second).toMatchObject({
      ok: false,
      error: { code: "DELIVERY_RECONCILIATION_REQUIRED" },
    });
    expect(grab.create).toHaveBeenCalledOnce();
    await expect(
      env.DB.prepare(
        "SELECT status, last_error_code FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(id)
        .first(),
    ).resolves.toEqual({ status: "OUTCOME_UNKNOWN", last_error_code: "GRAB_OUTCOME_UNKNOWN" });
  });

  it("rejects a replay that changes the immutable outbound request", async () => {
    const id = `job-conflict-${crypto.randomUUID()}`;
    await deliveryJob(id);
    const input = request(`merchant-${id}`);
    const grab = provider({
      ok: false,
      error: { code: "GRAB_HTTP_400", retryable: false, outcomeUnknown: false },
    });
    await requestProviderDelivery(env.DB, grab, {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      request: input,
    });

    const changed = await requestProviderDelivery(env.DB, grab, {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      request: { ...input, recipient: { ...input.recipient, name: "Different Recipient" } },
    });
    expect(changed).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("atomically refuses the provider claim after the delivery job version or assignment changes", async () => {
    const id = `job-provider-stale-${crypto.randomUUID()}`;
    await deliveryJob(id);
    await env.DB.prepare(
      "UPDATE delivery_job SET status='ASSIGNED',version=2,updated_at=2 WHERE id=?",
    )
      .bind(id)
      .run();
    const grab = provider({
      ok: false,
      error: { code: "SHOULD_NOT_RUN", retryable: false, outcomeUnknown: false },
    });
    const result = await requestProviderDelivery(env.DB, grab, {
      requestId: crypto.randomUUID(),
      deliveryJobId: id,
      expectedDeliveryJobVersion: 1,
      clientIdempotencyKey: crypto.randomUUID(),
      request: request(`merchant-${id}`),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "DELIVERY_DISPATCH_UNAVAILABLE" },
    });
    expect(grab.create).not.toHaveBeenCalled();
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(id)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });
});
