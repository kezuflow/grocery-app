import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type AuthEnvironment } from "../../auth/service";
import type { ResolvedApplicationContext } from "../../auth/authorization";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import {
  cancelExternalDelivery,
  getLocationDeliveryProfile,
  refreshExternalDelivery,
  requestExternalDelivery,
  upsertLocationDeliveryProfile,
} from "./delivery-provider-operations";

const LOCATION = "location-cebu-central";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM fulfillment_location_delivery_profile WHERE location_id=?")
    .bind(LOCATION)
    .run();
});

function accessContext(capabilities: readonly ("delivery.read" | "delivery.manage")[]) {
  return {
    authenticated: true,
    principal: {
      userId: "auth-delivery-operator",
      email: "delivery-operator@example.com",
      name: "Delivery operator",
      emailVerified: true,
    },
    capabilities,
    scopes: [{ kind: "location", locationId: LOCATION }],
    staffIdentity: {
      id: "staff-delivery-operator",
      authUserId: "auth-delivery-operator",
      displayName: "Delivery operator",
      status: "active",
    },
  } as ResolvedApplicationContext;
}

function dependencies(capabilities: readonly ("delivery.read" | "delivery.manage")[]) {
  return {
    auth: createAuth(env as Env & AuthEnvironment),
    db: env.DB,
    accessContext: accessContext(capabilities),
  };
}

function profileRequest(expectedVersion: number, idempotencyKey = crypto.randomUUID()) {
  return {
    requestId: crypto.randomUUID(),
    headers: {},
    locationId: LOCATION,
    senderName: "FreshMarkets Central Cebu",
    phoneE164: "+639171110000",
    email: "dispatch@freshmarkets.ph",
    formattedAddress: "1 FreshMarkets Road, Cebu City, Philippines",
    addressLine1: "1 FreshMarkets Road",
    addressLine2: "Receiving entrance",
    barangay: "Luz",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
    pickupInstructions: "Use the receiving entrance.",
    expectedVersion,
    idempotencyKey,
  } as const;
}

describe("location delivery profiles", () => {
  it("creates, reads, updates, and idempotently replays the profile for one store location", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const before = await getLocationDeliveryProfile(deps, {
      requestId: crypto.randomUUID(),
      headers: {},
      locationId: LOCATION,
    });
    expect(before).toMatchObject({ ok: true, value: { locationId: LOCATION, profile: null } });

    const key = crypto.randomUUID();
    const created = await upsertLocationDeliveryProfile(deps, profileRequest(0, key));
    const replay = await upsertLocationDeliveryProfile(deps, profileRequest(0, key));
    expect(created).toMatchObject({
      ok: true,
      value: {
        locationId: LOCATION,
        profile: { senderName: "FreshMarkets Central Cebu", version: 1 },
      },
    });
    expect(replay).toMatchObject({ ok: true, value: { profile: { version: 1 } } });

    const updated = await upsertLocationDeliveryProfile(deps, {
      ...profileRequest(1),
      pickupInstructions: "Ask for the packing lead.",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { profile: { pickupInstructions: "Ask for the packing lead.", version: 2 } },
    });
  });
});

async function seedScheduledDelivery(now: number) {
  const suffix = crypto.randomUUID();
  const customerId = `customer-provider-${suffix}`;
  const paymentId = `payment-provider-${suffix}`;
  const orderId = `order-provider-${suffix}`;
  const jobId = `job-provider-${suffix}`;
  const addressComponents = {
    addressLine1: "25 Customer Street",
    addressLine2: "Unit 2",
    barangay: "Mabolo",
    city: "Cebu City",
    region: "Central Visayas",
    postalCode: "6000",
    countryCode: "PH",
  };
  const addressSnapshot = JSON.stringify({
    address_components_json: JSON.stringify(addressComponents),
    city: "Cebu City",
    postal_code: "6000",
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id,auth_user_id,status,version,created_at,updated_at) VALUES (?,?,'active',1,?,?)",
    ).bind(customerId, `auth-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at,version) VALUES (?,?,12500,'PHP','SUCCEEDED','mock',?,?,?,1)",
    ).bind(paymentId, customerId, `payment-key-${suffix}`, now, now),
    env.DB.prepare(
      "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at) VALUES (?,?,'cycle-next-cebu','SCHEDULED',?,'COMMITTED',12500,'PHP',?,1,?)",
    ).bind(orderId, customerId, addressSnapshot, paymentId, now),
    env.DB.prepare(
      `INSERT INTO order_fulfillment_snapshot
       (order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,promised_at,
        fulfillment_mode,sourcing_modes_json,delivery_execution_snapshot_json,created_at)
       VALUES (?,?,'cycle-next-cebu','zone-cebu-city-core',?,?,NULL,'SCHEDULED','[]',?,?)`,
    ).bind(
      orderId,
      LOCATION,
      now + 60_000,
      now + 24 * 60 * 60_000,
      JSON.stringify({
        selectedBy: "OPERATIONS",
        method: null,
        providerCode: null,
        providerServiceType: null,
      }),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO delivery_job
       (id,order_id,cycle_id,fulfillment_mode,location_id,zone_id,rider_id,status,
        context_resolution_status,address_snapshot_json,version,created_at,updated_at)
       VALUES (?,?,'cycle-next-cebu','SCHEDULED',?,'zone-cebu-city-core',NULL,'UNASSIGNED',
               'RESOLVED',?,1,?,?)`,
    ).bind(jobId, orderId, LOCATION, addressSnapshot, now, now),
    env.DB.prepare(
      `INSERT INTO delivery_stop
       (id,delivery_job_id,batch_id,sequence,latitude,longitude,address_snapshot_json,
        contact_snapshot_json,instructions_snapshot,status,version,created_at,updated_at)
       VALUES (?, ?, NULL, NULL, 10.33, 123.91, ?, ?, ?, 'UNASSIGNED', 1, ?, ?)`,
    ).bind(
      `stop-${suffix}`,
      jobId,
      addressSnapshot,
      JSON.stringify({ recipient: "Ana Customer", phone: "+639171234567" }),
      JSON.stringify({ buildingUnit: "Unit 2", landmark: "Blue gate" }),
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO order_item
       (id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,
        quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,
        shipping_weight_grams)
       VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',2,6250,12500,1000,'GRAM',1000)`,
    ).bind(`item-${suffix}`, orderId),
  ]);
  return { orderId, jobId };
}

describe("external delivery request", () => {
  it("builds the courier request from the store profile, stop snapshot, and order weight", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(now);
    const create = vi.fn<DeliveryProvider["create"]>(async (request) => ({
      ok: true,
      value: {
        providerDeliveryId: "lala-order-1",
        merchantOrderId: request.merchantOrderId,
        status: "ALLOCATING",
        trackingUrl: "https://share.example/lala-order-1",
        pickupPin: null,
        quote: {
          providerQuotationId: "quote-lala-1",
          serviceType: request.serviceType,
          amountMinor: 4000,
          currency: "PHP",
          expiresAt: null,
          estimatedPickupAt: null,
          estimatedDropoffAt: null,
          distanceMeters: 4500,
        },
      },
    }));
    const provider: DeliveryProvider = {
      code: "lalamove",
      capabilities: {
        immediateQuotation: true,
        scheduledQuotation: { supported: true, maximumAdvanceMilliseconds: 2_592_000_000 },
        createDelivery: true,
        retrieveDelivery: true,
        cancelDelivery: true,
        signedStatusWebhooks: true,
        requiresPackageDimensions: false,
      },
      quote: vi.fn(),
      create,
      get: vi.fn(async () => ({
        ok: true as const,
        value: {
          providerDeliveryId: "lala-order-1",
          merchantOrderId: delivery.orderId,
          status: "IN_DELIVERY" as const,
          trackingUrl: "https://share.example/lala-order-1",
          pickupPin: null,
          quote: null,
        },
      })),
      cancel: vi.fn(async () => ({ ok: true as const, value: null })),
    };
    const bookingKey = crypto.randomUUID();
    const bookingRequest = {
      requestId: crypto.randomUUID(),
      headers: {},
      locationId: LOCATION,
      jobId: delivery.jobId,
      expectedVersion: 1,
      providerCode: "lalamove" as const,
      pickup: { kind: "IMMEDIATE" as const },
      idempotencyKey: bookingKey,
    };
    const result = await requestExternalDelivery(
      { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now },
      bookingRequest,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { provider: "lalamove", status: "ACTIVE", quoteAmountMinor: 4000 },
    });
    expect(create).toHaveBeenCalledOnce();
    await expect(
      env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first(),
    ).resolves.toEqual({ status: "ASSIGNED", version: 2 });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      merchantOrderId: delivery.orderId,
      serviceType: "MOTORCYCLE",
      packages: [{ kind: "BAG", quantity: 1, weightGrams: 1000 }],
      sender: { name: "FreshMarkets Central Cebu", phoneE164: "+639171110000" },
      recipient: { name: "Ana Customer", phoneE164: "+639171234567" },
      origin: { coordinate: { latitude: 10.3157, longitude: 123.8854 } },
      destination: {
        coordinate: { latitude: 10.33, longitude: 123.91 },
        instructions: { buildingUnit: "Unit 2", landmark: "Blue gate" },
      },
      schedule: null,
    });
    if (!result.ok) return;
    const refreshed = await refreshExternalDelivery(
      { ...deps, provider, now: () => now + 1 },
      {
        requestId: crypto.randomUUID(),
        headers: {},
        locationId: LOCATION,
        dispatchId: result.value.dispatchId,
        expectedVersion: result.value.version,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(refreshed).toMatchObject({
      ok: true,
      value: { providerStatus: "IN_DELIVERY", version: 4 },
    });
    if (!refreshed.ok) return;
    const canceled = await cancelExternalDelivery(
      { ...deps, provider, now: () => now + 2 },
      {
        requestId: crypto.randomUUID(),
        headers: {},
        locationId: LOCATION,
        dispatchId: result.value.dispatchId,
        expectedVersion: refreshed.value.version,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(canceled).toMatchObject({ ok: true, value: { status: "CANCELED", version: 5 } });
    const replay = await requestExternalDelivery(
      { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now + 3 },
      { ...bookingRequest, requestId: crypto.randomUUID() },
    );
    expect(replay).toMatchObject({ ok: true, value: { status: "CANCELED", version: 5 } });
    expect(create).toHaveBeenCalledOnce();
  });
});
