import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type AuthEnvironment } from "../../auth/service";
import type { ResolvedApplicationContext } from "../../auth/authorization";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import { advanceFulfillment } from "../../operations/application/advance-fulfillment";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";
import { reconcileProviderObservations } from "../../delivery/application/reconcile-provider-observations";
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
      "INSERT INTO fulfillment_record (id,order_id,location_id,status,updated_at) VALUES (?, ?, ?, 'NOT_STARTED', ?)",
    ).bind(`fulfillment-${suffix}`, orderId, LOCATION, now),
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

async function seedActiveDispatch(now: number) {
  const delivery = await seedScheduledDelivery(now);
  const dispatchId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO delivery_provider_dispatch
    (id,delivery_job_id,provider,merchant_order_id,provider_delivery_id,request_hash,request_snapshot_json,status,provider_status,version,created_at,updated_at)
    VALUES (?,?,'lalamove',?,?,'fixture','{}','ACTIVE','ALLOCATING',1,?,?)`)
    .bind(dispatchId, delivery.jobId, delivery.orderId, `provider-${dispatchId}`, now, now)
    .run();
  return { ...delivery, dispatchId };
}

describe("external delivery request", () => {
  it("recovers an uncertain booking only from matching provider metadata and replays the original command", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(now);
    const provider = createMockDeliveryProvider();
    provider.create = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "PROVIDER_TIMEOUT",
        message: "Unknown",
        retryable: false,
        outcomeUnknown: true,
      },
    }));
    const booking = {
      requestId: crypto.randomUUID(),
      headers: {},
      locationId: LOCATION,
      jobId: delivery.jobId,
      expectedVersion: 1,
      providerCode: "lalamove" as const,
      pickup: { kind: "IMMEDIATE" as const },
      idempotencyKey: crypto.randomUUID(),
    };
    const dependenciesWithProvider = {
      ...deps,
      provider,
      configuredServiceType: "MOTORCYCLE",
      now: () => now,
    };
    expect((await requestExternalDelivery(dependenciesWithProvider, booking)).ok).toBe(false);
    const dispatch = await env.DB.prepare(
      "SELECT id,version,merchant_order_id FROM delivery_provider_dispatch WHERE delivery_job_id=?",
    )
      .bind(delivery.jobId)
      .first<{ id: string; version: number; merchant_order_id: string }>();
    expect(dispatch).not.toBeNull();
    if (!dispatch) return;
    const refresh = {
      ...booking,
      dispatchId: dispatch.id,
      expectedVersion: dispatch.version,
      providerDeliveryId: "recovered-provider-order",
      idempotencyKey: crypto.randomUUID(),
    };
    const observation = {
      providerDeliveryId: refresh.providerDeliveryId,
      merchantOrderId: "other-order",
      status: "ALLOCATING" as const,
      trackingUrl: null,
      pickupPin: null,
      quote: null,
    };
    provider.get = vi.fn(async () => ({ ok: true as const, value: observation }));
    expect((await refreshExternalDelivery(dependenciesWithProvider, refresh)).ok).toBe(false);
    expect(
      await env.DB.prepare("SELECT provider_delivery_id FROM delivery_provider_dispatch WHERE id=?")
        .bind(dispatch.id)
        .first(),
    ).toEqual({ provider_delivery_id: null });
    observation.merchantOrderId = dispatch.merchant_order_id;
    const forbidden = await refreshExternalDelivery(
      { ...dependenciesWithProvider, accessContext: accessContext(["delivery.read"]) },
      { ...refresh, idempotencyKey: crypto.randomUUID() },
    );
    expect(forbidden.ok).toBe(false);
    expect(provider.get).toHaveBeenCalledTimes(1);
    await env.DB.prepare(`CREATE TRIGGER reject_identity_audit BEFORE INSERT ON audit_event
      WHEN NEW.action='DELIVERY.EXTERNAL_PROVIDER_IDENTITY_RECOVERED' BEGIN SELECT RAISE(ABORT,'identity audit failure'); END;`).run();
    try {
      await expect(
        refreshExternalDelivery(dependenciesWithProvider, {
          ...refresh,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow("identity audit failure");
      expect(
        await env.DB.prepare(
          "SELECT provider_delivery_id,version FROM delivery_provider_dispatch WHERE id=?",
        )
          .bind(dispatch.id)
          .first(),
      ).toEqual({ provider_delivery_id: null, version: dispatch.version });
      expect(
        await env.DB.prepare(
          "SELECT status FROM idempotency_records WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=?",
        )
          .bind(booking.idempotencyKey)
          .first(),
      ).toEqual({ status: "FAILED" });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_identity_audit");
    }
    const recover = { ...refresh, idempotencyKey: crypto.randomUUID() };
    const competing = await Promise.all([
      refreshExternalDelivery(dependenciesWithProvider, recover),
      refreshExternalDelivery(dependenciesWithProvider, {
        ...recover,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(competing.filter((result) => result.ok)).toHaveLength(1);
    const recovered = competing.find((result) => result.ok);

    expect(recovered).toMatchObject({
      ok: true,
      value: { providerDeliveryId: refresh.providerDeliveryId, status: "ACTIVE" },
    });
    expect(await requestExternalDelivery(dependenciesWithProvider, booking)).toMatchObject({
      ok: true,
      value: { providerDeliveryId: refresh.providerDeliveryId },
    });
    if (competing[0]?.ok)
      expect(await refreshExternalDelivery(dependenciesWithProvider, recover)).toMatchObject({
        ok: true,
      });
    expect(provider.create).toHaveBeenCalledOnce();
    expect(provider.get).toHaveBeenCalledTimes(4);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_event WHERE aggregate_id=? AND action='DELIVERY.EXTERNAL_PROVIDER_IDENTITY_RECOVERED'",
      )
        .bind(dispatch.id)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("submits only one of two concurrent cancellation commands", async () => {
    const now = Date.now();
    const { dispatchId } = await seedActiveDispatch(now);
    const cancel = vi.fn<DeliveryProvider["cancel"]>(async () => ({
      ok: false,
      error: { code: "TIMEOUT", retryable: true, outcomeUnknown: true },
    }));
    const deps = {
      ...dependencies(["delivery.manage"]),
      provider: { ...createMockDeliveryProvider(), code: "lalamove", cancel },
      now: () => now,
    };
    const request = {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
      dispatchId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    const results = await Promise.all([
      cancelExternalDelivery(deps, request),
      cancelExternalDelivery(deps, { ...request, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_command WHERE dispatch_id=? AND operation='CANCEL'",
      )
        .bind(dispatchId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM delivery_provider_dispatch WHERE id=?")
        .bind(dispatchId)
        .first(),
    ).toEqual({ status: "OUTCOME_UNKNOWN" });
  });
  it.each(["returned", "thrown"])(
    "persists a %s cancellation timeout and never resubmits it under a new key",
    async (timeout) => {
      const now = Date.now();
      const delivery = await seedActiveDispatch(now);
      const { dispatchId } = delivery;
      const cancel = vi.fn<DeliveryProvider["cancel"]>(async () => {
        if (timeout === "thrown") throw new Error("Provider connection interrupted");
        return {
          ok: false,
          error: { code: "LALAMOVE_TIMEOUT", retryable: true, outcomeUnknown: true },
        };
      });
      const deps = {
        ...dependencies(["delivery.manage"]),
        provider: { ...createMockDeliveryProvider(), code: "lalamove", cancel },
        now: () => now,
      };
      const request = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        dispatchId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      expect(await cancelExternalDelivery(deps, request)).toMatchObject({ ok: false });
      const current = await env.DB.prepare(
        "SELECT status,version FROM delivery_provider_dispatch WHERE id=?",
      )
        .bind(dispatchId)
        .first<{ status: string; version: number }>();
      expect(
        await cancelExternalDelivery(deps, {
          ...request,
          expectedVersion: current?.version ?? 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false });
      expect(cancel).toHaveBeenCalledOnce();
      expect(current?.status).toBe("OUTCOME_UNKNOWN");
      const lostReadKey = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO idempotency_records (scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES ('admin.delivery.externalRefresh',?,'lost-read','refresh','PROCESSING',?,?)",
        ).bind(lostReadKey, now, now),
        env.DB.prepare(`INSERT INTO delivery_provider_command
        (id,dispatch_id,operation,idempotency_scope,idempotency_key,request_hash,actor_user_id,location_id,request_id,status,created_at,updated_at)
        VALUES (?,?,'REFRESH','admin.delivery.externalRefresh',?,'lost-read','auth-delivery-operator',?,?,'SUBMITTING',?,?)`).bind(
          crypto.randomUUID(),
          dispatchId,
          lostReadKey,
          LOCATION,
          crypto.randomUUID(),
          now,
          now,
        ),
      ]);
      await reconcileProviderObservations(env.DB, now + 600_000);
      expect(
        await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
          .bind(lostReadKey)
          .first(),
      ).toEqual({ status: "FAILED" });
      expect(
        await env.DB.prepare(
          "SELECT status FROM delivery_provider_command WHERE operation='CANCEL' AND idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ status: "OUTCOME_UNKNOWN" });
      const get = vi.fn<DeliveryProvider["get"]>(async () => ({
        ok: true,
        value: {
          providerDeliveryId: `provider-${dispatchId}`,
          merchantOrderId: delivery.orderId,
          status: "CANCELED",
          trackingUrl: null,
          pickupPin: null,
          quote: null,
        },
      }));
      const refresh = await refreshExternalDelivery(
        { ...deps, provider: { ...deps.provider, get }, now: () => now + 1 },
        {
          ...request,
          expectedVersion: current?.version ?? 2,
          idempotencyKey: crypto.randomUUID(),
        },
      );
      expect(refresh).toMatchObject({ ok: true, value: { status: "CANCELED" } });
      expect(await cancelExternalDelivery(deps, request)).toMatchObject({
        ok: true,
        value: { status: "CANCELED" },
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(
        await env.DB.prepare(
          "SELECT status FROM delivery_provider_command WHERE operation='CANCEL' AND idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ status: "SUCCEEDED" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=? AND action='DELIVERY.EXTERNAL_PROVIDER_CANCELED'",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 1 });
    },
  );

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
          merchantOrderId: create.mock.calls[0]?.[0].merchantOrderId ?? "missing-booking",
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
      merchantOrderId: expect.stringMatching(/^fm-/),
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
    const early = await refreshExternalDelivery(
      { ...deps, provider, now: () => now },
      {
        requestId: crypto.randomUUID(),
        headers: {},
        locationId: LOCATION,
        dispatchId: result.value.dispatchId,
        expectedVersion: result.value.version,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(early).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare(
        "SELECT last_error_code FROM delivery_provider_event_inbox WHERE dispatch_id=?",
      )
        .bind(result.value.dispatchId)
        .first(),
    ).toEqual({ last_error_code: "DELIVERY_PACKING_NOT_COMPLETE" });
    for (const [index, action] of (
      ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING", "MARK_PACKED"] as const
    ).entries()) {
      expect(
        await advanceFulfillment(
          env.DB,
          {
            requestId: crypto.randomUUID(),
            headers: {},
            orderId: delivery.orderId,
            action,
            expectedVersion: index + 1,
            idempotencyKey: crypto.randomUUID(),
          },
          { authorize: async () => true },
        ),
      ).toMatchObject({ ok: true });
    }
    const refreshRequest = {
      requestId: crypto.randomUUID(),
      headers: {},
      locationId: LOCATION,
      dispatchId: result.value.dispatchId,
      expectedVersion: result.value.version,
      idempotencyKey: crypto.randomUUID(),
    };
    await env.DB.prepare(`CREATE TRIGGER reject_refresh_projection BEFORE UPDATE ON delivery_job
      WHEN NEW.status='EN_ROUTE' BEGIN SELECT RAISE(ABORT,'test refresh projection failure'); END`).run();
    try {
      await expect(
        refreshExternalDelivery({ ...deps, provider, now: () => now + 1 }, refreshRequest),
      ).rejects.toThrow("test refresh projection failure");
      expect(
        await env.DB.prepare("SELECT status FROM delivery_provider_command WHERE idempotency_key=?")
          .bind(refreshRequest.idempotencyKey)
          .first(),
      ).toEqual({ status: "OBSERVED" });
      expect(
        await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
          .bind(refreshRequest.idempotencyKey)
          .first(),
      ).toEqual({ status: "PROCESSING" });
      expect(
        await env.DB.prepare("SELECT version FROM delivery_provider_dispatch WHERE id=?")
          .bind(result.value.dispatchId)
          .first(),
      ).toEqual({ version: 3 });
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_refresh_projection").run();
    }
    await reconcileProviderObservations(env.DB, Date.now());
    const callsBeforeReplay = vi.mocked(provider.get).mock.calls.length;
    const refreshed = await refreshExternalDelivery(
      { ...deps, provider, now: () => now + 1 },
      refreshRequest,
    );
    expect(vi.mocked(provider.get).mock.calls.length).toBe(callsBeforeReplay);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=? AND action='DELIVERY.EXTERNAL_PROVIDER_REFRESHED'",
      )
        .bind(refreshRequest.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(refreshed).toMatchObject({
      ok: true,
      value: { providerStatus: "IN_DELIVERY", version: 5 },
    });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY" });
    expect(
      await env.DB.prepare("SELECT status FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ status: "EN_ROUTE" });
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
    expect(canceled).toMatchObject({ ok: true, value: { status: "CANCELED", version: 7 } });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY" });
    expect(
      await env.DB.prepare("SELECT status FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ status: "FAILED" });
    const replay = await requestExternalDelivery(
      { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now + 3 },
      { ...bookingRequest, requestId: crypto.randomUUID() },
    );
    expect(replay).toMatchObject({ ok: true, value: { status: "CANCELED", version: 7 } });
    expect(create).toHaveBeenCalledOnce();
  });
});
