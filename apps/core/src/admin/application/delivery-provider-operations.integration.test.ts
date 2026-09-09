import { projectDomainNotifications } from "../../notifications/application/project-domain-notifications";
import { reviseDeliveryPromise } from "../../delivery/application/revise-delivery-promise";
import { bookAutomaticInstantDeliveries } from "../../delivery/application/book-automatic-instant-deliveries";
import { expireUnsubmittedBookings } from "../../delivery/application/expire-unsubmitted-bookings";
import { manageManualDelivery } from "../../delivery/application/manage-manual-delivery";
import { listAdminDeliveryOperations } from "./operations-reads";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type AuthEnvironment } from "../../auth/service";
import type { ResolvedApplicationContext } from "../../auth/authorization";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import { recordReceivedLine } from "../../procurement/application/record-received-line";
import { startReceiving } from "../../procurement/application/start-receiving";
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
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('auth-delivery-operator','Delivery operator','delivery-operator@example.com',1,1,1)",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_identity(id,auth_user_id,display_name,status,created_at,updated_at) VALUES ('staff-delivery-operator','auth-delivery-operator','Delivery operator','active',1,1)",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role(id,code,name,created_at) VALUES ('role-delivery-test','delivery-test','Delivery test',1)",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_role(staff_id,role_id) VALUES ('staff-delivery-operator','role-delivery-test')",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_scope(id,staff_id,scope_kind,location_id) VALUES ('scope-delivery-test','staff-delivery-operator','location',?)",
    ).bind(LOCATION),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission(role_id,permission_id) SELECT 'role-delivery-test',id FROM permission WHERE code IN ('delivery.read','delivery.manage')",
    ),
  ]);
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
  it("keeps pickup profile reads available to scoped operations after site deactivation", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    expect((await upsertLocationDeliveryProfile(deps, profileRequest(0))).ok).toBe(true);
    await env.DB.prepare("UPDATE fulfillment_location SET status='inactive' WHERE id=?")
      .bind(LOCATION)
      .run();
    try {
      expect(
        await getLocationDeliveryProfile(deps, {
          headers: {},
          requestId: crypto.randomUUID(),
          locationId: LOCATION,
        }),
      ).toMatchObject({
        ok: true,
        value: { profile: { senderName: "FreshMarkets Central Cebu" } },
      });
    } finally {
      await env.DB.prepare("UPDATE fulfillment_location SET status='active' WHERE id=?")
        .bind(LOCATION)
        .run();
    }
  });
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

async function seedScheduledDelivery(now: number, mode: "INSTANT" | "SCHEDULED" = "SCHEDULED") {
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
      "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at) VALUES (?,?,?,?,?,'COMMITTED',12500,'PHP',?,1,?)",
    ).bind(
      orderId,
      customerId,
      mode === "SCHEDULED" ? "cycle-next-cebu" : null,
      mode,
      addressSnapshot,
      paymentId,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO fulfillment_record (id,order_id,location_id,status,updated_at) VALUES (?, ?, ?, 'NOT_STARTED', ?)",
    ).bind(`fulfillment-${suffix}`, orderId, LOCATION, now),
    env.DB.prepare(
      `INSERT INTO order_fulfillment_snapshot
       (order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,promised_at,
        fulfillment_mode,sourcing_modes_json,delivery_execution_snapshot_json,created_at)
       VALUES (?,?,?,'zone-cebu-city-core',?,?,?,?,'[]',?,?)`,
    ).bind(
      orderId,
      LOCATION,
      mode === "SCHEDULED" ? "cycle-next-cebu" : null,
      mode === "SCHEDULED" ? now + 60_000 : null,
      mode === "SCHEDULED" ? now + 24 * 60 * 60_000 : null,
      mode === "INSTANT" ? now + 3600000 : null,
      mode,
      JSON.stringify({
        selectedBy: mode === "INSTANT" ? "CUSTOMER" : "OPERATIONS",
        method: mode === "INSTANT" ? "EXTERNAL_PROVIDER" : null,
        providerCode: mode === "INSTANT" ? "lalamove" : null,
        providerServiceType: mode === "INSTANT" ? "MOTORCYCLE" : null,
      }),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO delivery_job
       (id,order_id,cycle_id,fulfillment_mode,location_id,zone_id,rider_id,status,
        context_resolution_status,address_snapshot_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,'zone-cebu-city-core',NULL,'UNASSIGNED',
               'RESOLVED',?,1,?,?)`,
    ).bind(
      jobId,
      orderId,
      mode === "SCHEDULED" ? "cycle-next-cebu" : null,
      mode,
      LOCATION,
      addressSnapshot,
      now,
      now,
    ),
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

async function receiveScheduledTestGoods(delivery: { orderId: string }, now: number) {
  // This provider projection test uses seeded paid-order evidence; receive its goods
  // through commands before packing. It does not establish payment acceptance.
  const receiptId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) SELECT ?,order_id,'cycle-next-cebu',?,'pool-red-onion',base_quantity,'OPEN','EXACT_PAID_LINE',id,sku_id,quantity,base_quantity,'GRAM',1000,? FROM order_item WHERE order_id=?",
    ).bind(crypto.randomUUID(), LOCATION, now, delivery.orderId),
    env.DB.prepare(
      "INSERT INTO procurement_requirement(id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version) VALUES (?,'cycle-next-cebu',?,'pool-red-onion',1000,'ORDERED',1)",
    ).bind(receiptId, LOCATION),
    env.DB.prepare(
      "INSERT INTO receiving_record(id,procurement_requirement_id,expected_quantity,accepted_quantity,rejected_quantity,status,version) VALUES (?,?,1000,0,0,'NOT_STARTED',1)",
    ).bind(receiptId, receiptId),
  ]);
  expect(
    await startReceiving(env.DB, {
      requirementId: receiptId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(
    await recordReceivedLine(env.DB, {
      receivingRecordId: receiptId,
      acceptedDeltaBase: 1000,
      rejectedDeltaBase: 0,
      reason: "Inspected goods",
      expectedVersion: 2,
      idempotencyKey: crypto.randomUUID(),
      actorId: "test",
      requestId: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(
    await advanceFulfillment(
      env.DB,
      {
        headers: {},
        requestId: crypto.randomUUID(),
        orderId: delivery.orderId,
        action: "START_PICKING",
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      },
      { authorize: async () => true },
    ),
  ).toMatchObject({ ok: true });
}

describe("external delivery request", () => {
  it("recovers an interrupted unsubmitted booking without losing audit or calling the provider twice", async () => {
    const admittedAt = Date.now() - 300001;
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(admittedAt);
    await receiveScheduledTestGoods(delivery, admittedAt);
    const provider = createMockDeliveryProvider();
    const create = vi.spyOn(provider, "create");
    const request = {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
      jobId: delivery.jobId,
      expectedVersion: 1,
      providerCode: "lalamove" as const,
      pickup: { kind: "SCHEDULED" as const, pickupAt: new Date(admittedAt + 600000).toISOString() },
      idempotencyKey: crypto.randomUUID(),
    };
    await env.DB.exec(
      "CREATE TRIGGER interrupt_provider_claim BEFORE UPDATE ON delivery_provider_dispatch WHEN NEW.status='CREATING' BEGIN SELECT RAISE(ABORT,'interrupted before submit'); END",
    );
    try {
      await expect(
        requestExternalDelivery(
          { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => admittedAt },
          request,
        ),
      ).rejects.toThrow("interrupted before submit");
    } finally {
      await env.DB.exec("DROP TRIGGER interrupt_provider_claim");
    }
    expect(create).not.toHaveBeenCalled();
    const saved = await env.DB.prepare(
      "SELECT id,status,version FROM delivery_provider_dispatch WHERE delivery_job_id=?",
    )
      .bind(delivery.jobId)
      .first<{ id: string; status: string; version: number }>();
    expect(saved?.status).toBe("PENDING");
    if (!saved) throw new Error("Missing saved intent");
    expect(await expireUnsubmittedBookings(env.DB, admittedAt + 299999)).toBe(0);
    await env.DB.exec(
      "CREATE TRIGGER omit_expiry_audit BEFORE INSERT ON audit_event WHEN NEW.action='DELIVERY.UNSUBMITTED_BOOKING_EXPIRED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      await expect(expireUnsubmittedBookings(env.DB, admittedAt + 300000)).rejects.toThrow();
      expect(
        await env.DB.prepare("SELECT id,status,version FROM delivery_provider_dispatch WHERE id=?")
          .bind(saved.id)
          .first(),
      ).toEqual(saved);
      expect(
        await env.DB.prepare(
          "SELECT status FROM idempotency_records WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ status: "PROCESSING" });
    } finally {
      await env.DB.exec("DROP TRIGGER omit_expiry_audit");
    }
    const closed = await Promise.all([
      expireUnsubmittedBookings(env.DB, admittedAt + 300000),
      expireUnsubmittedBookings(env.DB, admittedAt + 300000),
    ]);
    expect(closed.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await expireUnsubmittedBookings(env.DB, admittedAt + 300001)).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_event WHERE aggregate_id=? AND action='DELIVERY.UNSUBMITTED_BOOKING_EXPIRED'",
      )
        .bind(saved.id)
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first(),
    ).toEqual({ status: "FULFILLMENT_PENDING" });
    const job = await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
      .bind(delivery.jobId)
      .first<{ status: string; version: number }>();
    if (!job) throw new Error("Missing job");
    expect(job.status).toBe("FAILED");
    expect(
      await requestExternalDelivery(
        { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: Date.now },
        { ...request, expectedVersion: job.version, idempotencyKey: crypto.randomUUID() },
      ),
    ).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledOnce();
  });

  it.each(["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED", "ACTIVE"])(
    "never expires a %s attempt that may have reached the provider",
    async (status) => {
      const now = Date.now();
      const delivery = await seedActiveDispatch(now - 600000);
      await env.DB.prepare(
        "UPDATE delivery_provider_dispatch SET status=?,provider_delivery_id=NULL WHERE id=?",
      )
        .bind(status, delivery.dispatchId)
        .run();
      expect(await expireUnsubmittedBookings(env.DB, now)).toBe(0);
      expect(
        await env.DB.prepare("SELECT status FROM delivery_provider_dispatch WHERE id=?")
          .bind(delivery.dispatchId)
          .first(),
      ).toEqual({ status });
    },
  );

  it.each(["INSTANT", "SCHEDULED"] as const)(
    "retries a closed %s courier attempt atomically and preserves its history",
    async (mode) => {
      const now = Date.now();
      const deps = dependencies(["delivery.read", "delivery.manage"]);
      await upsertLocationDeliveryProfile(deps, profileRequest(0));
      const delivery = await seedScheduledDelivery(now, mode);
      await env.DB.prepare("UPDATE delivery_job SET promised_at=? WHERE id=?")
        .bind(now + 3600000, delivery.jobId)
        .run();
      if (mode === "SCHEDULED") await receiveScheduledTestGoods(delivery, now);
      else {
        for (const [index, action] of (
          ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
        ).entries()) {
          expect(
            await advanceFulfillment(
              env.DB,
              {
                headers: {},
                requestId: crypto.randomUUID(),
                orderId: delivery.orderId,
                action,
                expectedVersion: index + 1,
                idempotencyKey: crypto.randomUUID(),
              },
              { authorize: async () => true },
            ),
          ).toMatchObject({ ok: true });
        }
      }
      const provider = createMockDeliveryProvider(() => now);
      const create = vi.spyOn(provider, "create");
      const bookingDeps = {
        ...deps,
        provider,
        configuredServiceType: "MOTORCYCLE",
        now: () => now,
      };
      const request = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        jobId: delivery.jobId,
        expectedVersion: 1,
        providerCode: "lalamove" as const,
        pickup:
          mode === "SCHEDULED"
            ? { kind: "SCHEDULED" as const, pickupAt: new Date(now + 600000).toISOString() }
            : { kind: "IMMEDIATE" as const },
        idempotencyKey: crypto.randomUUID(),
      };
      const first = await requestExternalDelivery(bookingDeps, request);
      if (!first.ok) throw new Error(first.error.message);
      expect(
        await cancelExternalDelivery(bookingDeps, {
          headers: {},
          requestId: crypto.randomUUID(),
          locationId: LOCATION,
          dispatchId: first.value.dispatchId,
          expectedVersion: first.value.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true, value: { status: "CANCELED" } });
      const job = await env.DB.prepare(
        "SELECT status,version,promised_at FROM delivery_job WHERE id=?",
      )
        .bind(delivery.jobId)
        .first<{ status: string; version: number; promised_at: number }>();
      if (!job) throw new Error("Missing job");
      expect(job.status).toBe("FAILED");
      const retry = {
        ...request,
        expectedVersion: job.version,
        idempotencyKey: crypto.randomUUID(),
      };
      expect(
        await requestExternalDelivery({ ...bookingDeps, now: () => now + 2 * 86400000 }, retry),
      ).toMatchObject({ ok: false });
      expect(create).toHaveBeenCalledTimes(1);
      const queue = await listAdminDeliveryOperations(deps, {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
      });
      expect(
        queue.ok &&
          queue.value.items.find((item) => item.jobId === delivery.jobId)?.courierPickup
            .allowedKinds,
      ).toContain(mode === "SCHEDULED" ? "SCHEDULED" : "IMMEDIATE");
      await env.DB.exec(
        "CREATE TRIGGER omit_retry_stop BEFORE UPDATE ON delivery_stop WHEN NEW.status='RETRY_SCHEDULED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        expect(await requestExternalDelivery(bookingDeps, retry)).toMatchObject({ ok: false });
        expect(create).toHaveBeenCalledTimes(1);
        expect(
          await env.DB.prepare("SELECT status,version,promised_at FROM delivery_job WHERE id=?")
            .bind(delivery.jobId)
            .first(),
        ).toEqual(job);
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
          )
            .bind(delivery.jobId)
            .first(),
        ).toEqual({ n: 1 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM idempotency_records WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=? AND status='SUCCEEDED'",
          )
            .bind(retry.idempotencyKey)
            .first(),
        ).toEqual({ n: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER omit_retry_stop");
      }
      const attempts = [
        { ...retry, idempotencyKey: crypto.randomUUID() },
        { ...retry, idempotencyKey: crypto.randomUUID() },
      ];
      const results = await Promise.all(
        attempts.map((attempt) => requestExternalDelivery(bookingDeps, attempt)),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const winner = results[0].ok ? 0 : 1;
      expect(await requestExternalDelivery(bookingDeps, attempts[winner])).toEqual(results[winner]);
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[0]?.[0].merchantOrderId).not.toEqual(
        create.mock.calls[1]?.[0].merchantOrderId,
      );
      expect(
        (
          await env.DB.prepare(
            "SELECT status,attempt_sequence FROM delivery_provider_dispatch WHERE delivery_job_id=? ORDER BY attempt_sequence",
          )
            .bind(delivery.jobId)
            .all()
        ).results,
      ).toEqual([
        { status: "CANCELED", attempt_sequence: 1 },
        { status: "ACTIVE", attempt_sequence: 2 },
      ]);
      expect(
        await env.DB.prepare("SELECT status,promised_at FROM delivery_job WHERE id=?")
          .bind(delivery.jobId)
          .first(),
      ).toEqual({ status: "RETRY_SCHEDULED", promised_at: job.promised_at });
      const successful = results[winner];
      if (!successful.ok) throw new Error("Missing successful retry");
      expect(
        await cancelExternalDelivery(bookingDeps, {
          headers: {},
          requestId: crypto.randomUUID(),
          locationId: LOCATION,
          dispatchId: successful.value.dispatchId,
          expectedVersion: successful.value.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
      const current = await env.DB.prepare("SELECT version FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first<{ version: number }>();
      if (!current) throw new Error("Missing retry job");
      create.mockResolvedValueOnce({
        ok: false,
        error: { code: "TIMEOUT", retryable: false, outcomeUnknown: true },
      });
      const unknown = {
        ...request,
        expectedVersion: current.version,
        idempotencyKey: crypto.randomUUID(),
      };
      expect(await requestExternalDelivery(bookingDeps, unknown)).toMatchObject({ ok: false });
      const blockedQueue = await listAdminDeliveryOperations(deps, {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
      });
      expect(
        blockedQueue.ok && blockedQueue.value.items.find((item) => item.jobId === delivery.jobId),
      ).toMatchObject({ courierPickup: { allowedKinds: [] }, manualActions: [] });
      expect(
        await requestExternalDelivery(bookingDeps, {
          ...unknown,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false });
      expect(create).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps automatic booking uncertain when its required audit is omitted", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const instant = await seedScheduledDelivery(now, "INSTANT");
    for (const [index, action] of (
      ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
    ).entries()) {
      expect(
        (
          await advanceFulfillment(
            env.DB,
            {
              headers: {},
              requestId: crypto.randomUUID(),
              orderId: instant.orderId,
              action,
              expectedVersion: index + 1,
              idempotencyKey: crypto.randomUUID(),
            },
            { authorize: async () => true },
          )
        ).ok,
      ).toBe(true);
    }
    const provider = createMockDeliveryProvider();
    const create = vi.spyOn(provider, "create");
    const providers = () => new Map([["lalamove", provider]]);
    await env.DB.exec(
      "CREATE TRIGGER omit_booking_audit BEFORE INSERT ON audit_event WHEN NEW.action='DELIVERY.EXTERNAL_PROVIDER_REQUESTED' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(
        await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
      ).toMatchObject({ submitted: 0, deferred: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER omit_booking_audit");
    }
    expect(
      await env.DB.prepare(
        "SELECT status,provider_delivery_id FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(instant.jobId)
        .first(),
    ).toEqual({ status: "CREATING", provider_delivery_id: null });
    expect(
      await env.DB.prepare(
        "SELECT status FROM idempotency_records WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=?",
      )
        .bind(`auto-book:${instant.jobId}`)
        .first(),
    ).toEqual({ status: "PROCESSING" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_event_inbox WHERE merchant_order_id=?",
      )
        .bind(`fm-auto-${instant.jobId}`)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
    ).toMatchObject({ attempted: 0 });
    expect(create).toHaveBeenCalledOnce();
  });

  it("rechecks revoked delivery permission before persisting a provider attempt", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(now);
    const provider = createMockDeliveryProvider();
    const create = vi.spyOn(provider, "create");
    await env.DB.prepare(
      "DELETE FROM role_permission WHERE role_id='role-delivery-test' AND permission_id=(SELECT id FROM permission WHERE code='delivery.manage')",
    ).run();
    const key = crypto.randomUUID();
    expect(
      (
        await requestExternalDelivery(
          { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now },
          {
            headers: {},
            requestId: crypto.randomUUID(),
            locationId: LOCATION,
            jobId: delivery.jobId,
            expectedVersion: 1,
            providerCode: "lalamove",
            pickup: { kind: "IMMEDIATE" },
            idempotencyKey: key,
          },
        )
      ).ok,
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
      )
        .bind(key)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("automatically books Instant only after checked items enter packing and never books Scheduled or a replacement", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const instant = await seedScheduledDelivery(now, "INSTANT");
    const scheduled = await seedScheduledDelivery(now);
    const provider = createMockDeliveryProvider();
    const create = vi.spyOn(provider, "create");
    const providers = () => new Map([["lalamove", provider]]);
    expect(
      await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
    ).toMatchObject({ attempted: 0 });
    for (const delivery of [instant, scheduled]) {
      for (const [index, action] of (
        ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
      ).entries()) {
        expect(
          (
            await advanceFulfillment(
              env.DB,
              {
                headers: {},
                requestId: crypto.randomUUID(),
                orderId: delivery.orderId,
                action,
                expectedVersion: index + 1,
                idempotencyKey: crypto.randomUUID(),
              },
              { authorize: async () => true },
            )
          ).ok,
        ).toBe(true);
        if (delivery === instant && action !== "START_PACKING")
          expect(
            await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
          ).toMatchObject({ attempted: 0 });
      }
    }
    // Interrupt after the durable request exists, before the external submission claim.
    await env.DB.exec(
      "CREATE TRIGGER interrupt_auto_submit BEFORE UPDATE ON delivery_provider_dispatch WHEN NEW.status='CREATING' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(
        await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
      ).toMatchObject({ submitted: 0, deferred: 1 });
      expect(create).not.toHaveBeenCalled();
      expect(
        await env.DB.prepare(
          "SELECT status FROM delivery_provider_dispatch WHERE delivery_job_id=?",
        )
          .bind(instant.jobId)
          .first(),
      ).toEqual({ status: "PENDING" });
    } finally {
      await env.DB.exec("DROP TRIGGER interrupt_auto_submit");
    }
    const results = await Promise.all([
      bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
      bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
    ]);
    expect(results.some((result) => result.submitted === 1)).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT status FROM idempotency_records WHERE scope='admin.delivery.externalDispatch' AND idempotency_key=?",
      )
        .bind(`auto-book:${instant.jobId}`)
        .first(),
    ).toEqual({ status: "SUCCEEDED" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE action='DELIVERY.EXTERNAL_PROVIDER_REQUESTED' AND idempotency_key=?",
      )
        .bind(`auto-book:${instant.jobId}`)
        .first(),
    ).toEqual({ count: 1 });
    expect(create).toHaveBeenCalledOnce();
    expect(
      await bookAutomaticInstantDeliveries(env.DB, providers, now, scheduled.orderId),
    ).toMatchObject({ attempted: 0 });
    expect(
      await bookAutomaticInstantDeliveries(env.DB, providers, now, instant.orderId),
    ).toMatchObject({ attempted: 0 });
    expect(
      await env.DB.prepare("SELECT status FROM delivery_job WHERE id=?")
        .bind(instant.jobId)
        .first(),
    ).toEqual({ status: "UNASSIGNED" });
    expect(
      await env.DB.prepare("SELECT status FROM fulfillment_record WHERE order_id=?")
        .bind(instant.orderId)
        .first(),
    ).toEqual({ status: "PACKING" });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      merchantOrderId: `fm-auto-${instant.jobId}`,
      serviceType: "MOTORCYCLE",
      schedule: null,
    });
  });

  it("recovers an uncertain booking only from matching provider metadata and replays the original command", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(now);
    await receiveScheduledTestGoods(delivery, now);
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
      pickup: { kind: "SCHEDULED" as const, pickupAt: new Date(now + 60_000).toISOString() },
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
    await receiveScheduledTestGoods(delivery, now);
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
      pickup: { kind: "SCHEDULED" as const, pickupAt: new Date(now + 60_000).toISOString() },
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
    ).resolves.toEqual({ status: "UNASSIGNED", version: 1 });
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
      schedule: { pickupFrom: new Date(now + 60_000).toISOString() },
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
    ).toEqual({ status: "FULFILLMENT_PENDING" });
    expect(
      await env.DB.prepare(
        "SELECT last_error_code FROM delivery_provider_event_inbox WHERE dispatch_id=? AND processing_status='RECONCILIATION_REQUIRED'",
      )
        .bind(result.value.dispatchId)
        .first(),
    ).toEqual({ last_error_code: "DELIVERY_PACKING_NOT_COMPLETE" });
    for (const [index, action] of (
      ["MARK_READY_TO_PACK", "START_PACKING", "MARK_PACKED"] as const
    ).entries()) {
      expect(
        await advanceFulfillment(
          env.DB,
          {
            requestId: crypto.randomUUID(),
            headers: {},
            orderId: delivery.orderId,
            action,
            expectedVersion: index + 2,
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
      ).toEqual({ version: result.value.version });
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
      value: { providerStatus: "IN_DELIVERY", version: result.value.version + 2 },
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
    expect(canceled).toMatchObject({
      ok: true,
      value: { status: "CANCELED", version: refreshed.value.version + 2 },
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
    ).toEqual({ status: "FAILED" });
    const replay = await requestExternalDelivery(
      { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now + 3 },
      { ...bookingRequest, requestId: crypto.randomUUID() },
    );
    expect(replay).toMatchObject({
      ok: true,
      value: { status: "CANCELED", version: refreshed.value.version + 2 },
    });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("Scheduled booking readiness", () => {
  it("rejects immediate pickup before packing and future pickup without available received goods", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    await upsertLocationDeliveryProfile(deps, profileRequest(0));
    const delivery = await seedScheduledDelivery(now);
    await receiveScheduledTestGoods(delivery, now);
    const provider = createMockDeliveryProvider();
    const create = vi.spyOn(provider, "create");
    const booking = {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
      jobId: delivery.jobId,
      expectedVersion: 1,
      providerCode: "lalamove" as const,
      idempotencyKey: crypto.randomUUID(),
    };
    const bookingDeps = { ...deps, provider, configuredServiceType: "MOTORCYCLE", now: () => now };
    expect(
      await requestExternalDelivery(bookingDeps, { ...booking, pickup: { kind: "IMMEDIATE" } }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    const balance = await env.DB.prepare(
      "SELECT disposed_base FROM cycle_goods_balance WHERE cycle_id='cycle-next-cebu' AND location_id=? AND inventory_pool_id='pool-red-onion'",
    )
      .bind(LOCATION)
      .first<{ disposed_base: number }>();
    if (!balance) throw new Error("Missing received-goods fixture");
    await env.DB.prepare(
      "UPDATE cycle_goods_balance SET disposed_base=received_base-packed_base-surplus_released_base WHERE cycle_id='cycle-next-cebu' AND location_id=? AND inventory_pool_id='pool-red-onion'",
    )
      .bind(LOCATION)
      .run();
    try {
      expect(
        await requestExternalDelivery(bookingDeps, {
          ...booking,
          pickup: { kind: "SCHEDULED", pickupAt: new Date(now + 60_000).toISOString() },
        }),
      ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    } finally {
      await env.DB.prepare(
        "UPDATE cycle_goods_balance SET disposed_base=? WHERE cycle_id='cycle-next-cebu' AND location_id=? AND inventory_pool_id='pool-red-onion'",
      )
        .bind(balance.disposed_base, LOCATION)
        .run();
    }
    expect(create).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(booking.idempotencyKey)
        .first(),
    ).toBeNull();
    for (const [index, action] of (
      ["MARK_READY_TO_PACK", "START_PACKING", "MARK_PACKED"] as const
    ).entries())
      expect(
        await advanceFulfillment(
          env.DB,
          {
            headers: {},
            requestId: crypto.randomUUID(),
            orderId: delivery.orderId,
            action,
            expectedVersion: index + 2,
            idempotencyKey: crypto.randomUUID(),
          },
          { authorize: async () => true },
        ),
      ).toMatchObject({ ok: true });
    expect(
      await requestExternalDelivery(bookingDeps, { ...booking, pickup: { kind: "IMMEDIATE" } }),
    ).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledOnce();
  });

  it.each(["shortage", "expired pickup"] as const)(
    "rechecks %s at admission without submitting or saving success",
    async (change) => {
      const now = Date.now();
      const deps = dependencies(["delivery.read", "delivery.manage"]);
      await upsertLocationDeliveryProfile(deps, profileRequest(0));
      const delivery = await seedScheduledDelivery(now);
      await receiveScheduledTestGoods(delivery, now);
      const provider = createMockDeliveryProvider();
      const create = vi.spyOn(provider, "create");
      const key = crypto.randomUUID();
      // Simulate a concurrent preparation change after the read and before admission.
      const db = new Proxy(env.DB, {
        get(database, member) {
          if (member === "prepare")
            return (sql: string) => {
              const statement = database.prepare(sql);
              if (
                change !== "shortage" ||
                !sql.includes("INSERT OR IGNORE INTO idempotency_records")
              )
                return statement;
              const wrap = (prepared: D1PreparedStatement): D1PreparedStatement =>
                new Proxy(prepared, {
                  get(target, method) {
                    if (method === "bind")
                      return (...values: unknown[]) => wrap(target.bind(...values));
                    if (method === "run")
                      return async () => {
                        const result = await target.run();
                        await database
                          .prepare(
                            "UPDATE fulfillment_record SET status='SHORTED',version=version+1 WHERE order_id=?",
                          )
                          .bind(delivery.orderId)
                          .run();
                        return result;
                      };
                    const value: unknown = Reflect.get(target, method);
                    return typeof value === "function" ? value.bind(target) : value;
                  },
                });
              return wrap(statement);
            };
          const value: unknown = Reflect.get(database, member);
          return typeof value === "function" ? value.bind(database) : value;
        },
      });
      let clockCalls = 0;
      expect(
        await requestExternalDelivery(
          {
            ...deps,
            db,
            provider,
            configuredServiceType: "MOTORCYCLE",
            now: () => (change === "expired pickup" && ++clockCalls > 1 ? now + 120_000 : now),
          },
          {
            headers: {},
            requestId: crypto.randomUUID(),
            locationId: LOCATION,
            jobId: delivery.jobId,
            expectedVersion: 1,
            providerCode: "lalamove",
            idempotencyKey: key,
            pickup: { kind: "SCHEDULED", pickupAt: new Date(now + 60_000).toISOString() },
          },
        ),
      ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(create).not.toHaveBeenCalled();
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
        )
          .bind(delivery.jobId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
          .bind(key)
          .first(),
      ).toEqual({ status: "FAILED" });
    },
  );
});

describe("Scheduled manual delivery", () => {
  function assign(jobId: string) {
    return {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
      jobId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      action: "ASSIGN" as const,
      reason: "Courier unavailable",
      personName: "Delivery helper",
      phoneE164: "+639171110000",
    };
  }

  it("allows one manual fallback after confirmed courier cancellation before handover", async () => {
    const now = Date.now();
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const delivery = await seedActiveDispatch(now);
    const provider = createMockDeliveryProvider(() => now);
    expect(await manageManualDelivery(deps, assign(delivery.jobId))).toMatchObject({ ok: false });
    const canceled = await cancelExternalDelivery(
      { ...deps, provider, now: () => now },
      {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        dispatchId: delivery.dispatchId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(canceled).toMatchObject({ ok: true, value: { status: "CANCELED" } });
    const job = await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
      .bind(delivery.jobId)
      .first<{ status: string; version: number }>();
    expect(job?.status).toBe("FAILED");
    if (!job) throw new Error("Missing delivery job");
    const queue = await listAdminDeliveryOperations(deps, {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
    });
    expect(
      queue.ok && queue.value.items.find((item) => item.jobId === delivery.jobId),
    ).toMatchObject({ manualActions: ["ASSIGN"] });
    const request = { ...assign(delivery.jobId), expectedVersion: job.version };
    const competingRequest = { ...request, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      manageManualDelivery(deps, request),
      manageManualDelivery(deps, competingRequest),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results[0].ok ? 0 : 1;
    expect(await manageManualDelivery(deps, winner === 0 ? request : competingRequest)).toEqual(
      results[winner],
    );
    expect(
      (
        await env.DB.prepare(
          "SELECT method,status,attempt_sequence FROM delivery_provider_dispatch WHERE delivery_job_id=? ORDER BY attempt_sequence",
        )
          .bind(delivery.jobId)
          .all()
      ).results,
    ).toEqual([
      { method: "EXTERNAL", status: "CANCELED", attempt_sequence: 1 },
      { method: "MANUAL", status: "ACTIVE", attempt_sequence: 2 },
    ]);
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first(),
    ).toEqual({ status: "COMMITTED" });
  });

  it("rejects Instant, unresolved courier work, invalid contact, and missing capability without a receipt", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const instant = await seedScheduledDelivery(Date.now(), "INSTANT");
    expect(await manageManualDelivery(deps, assign(instant.jobId))).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    for (const action of ["HAND_OVER", "COMPLETE", "FAIL"] as const) {
      expect(
        await manageManualDelivery(deps, {
          ...assign(instant.jobId),
          action,
          dispatchId: "unused",
          actualCostMinor: null,
        }),
      ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    }
    const external = await seedActiveDispatch(Date.now());
    expect(await manageManualDelivery(deps, assign(external.jobId))).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    await env.DB.prepare(
      "UPDATE delivery_provider_dispatch SET status='OUTCOME_UNKNOWN' WHERE id=?",
    )
      .bind(external.dispatchId)
      .run();
    expect(await manageManualDelivery(deps, assign(external.jobId))).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    const delivery = await seedScheduledDelivery(Date.now());
    const request = assign(delivery.jobId);
    expect(await manageManualDelivery(deps, { ...request, phoneE164: "123" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(await manageManualDelivery(dependencies(["delivery.read"]), request)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM idempotency_records WHERE scope='delivery.manual' AND idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("saves one assignment under concurrent replay, enforces custody, and returns frozen receipts after completion", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const delivery = await seedScheduledDelivery(Date.now());
    await env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) SELECT c.auth_user_id,'Synthetic customer',c.id || '@example.com',1,1,1 FROM customer c JOIN grocery_order o ON o.customer_id=c.id WHERE o.id=?",
    )
      .bind(delivery.orderId)
      .run();
    const request = assign(delivery.jobId);
    const [assigned, duplicate] = await Promise.all([
      manageManualDelivery(deps, request),
      manageManualDelivery(deps, request),
    ]);
    expect(assigned).toMatchObject({ ok: true, value: { status: "ACTIVE", version: 1 } });
    expect(duplicate).toEqual(assigned);
    if (!assigned.ok) throw new Error("Assignment failed");
    const base = {
      ...request,
      dispatchId: assigned.value.dispatchId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    expect(
      await manageManualDelivery(deps, { ...base, action: "COMPLETE", actualCostMinor: null }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(await manageManualDelivery(deps, { ...base, action: "HAND_OVER" })).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE fulfillment_record SET status='PACKED',version=version+1 WHERE order_id=?",
      ).bind(delivery.orderId),
      env.DB.prepare(
        "UPDATE grocery_order SET status='FULFILLMENT_READY',version=version+1 WHERE id=?",
      ).bind(delivery.orderId),
    ]);
    const queue = await listAdminDeliveryOperations(deps, {
      headers: {},
      requestId: crypto.randomUUID(),
      locationId: LOCATION,
    });
    expect(
      queue.ok && queue.value.items.find((item) => item.jobId === delivery.jobId),
    ).toMatchObject({
      manualActions: ["HAND_OVER", "FAIL"],
      manualDelivery: { personName: "Delivery helper" },
      externalDispatch: null,
    });
    expect(
      await advanceFulfillment(
        env.DB,
        {
          headers: {},
          requestId: crypto.randomUUID(),
          orderId: delivery.orderId,
          action: "HAND_OFF",
          expectedVersion: 2,
          idempotencyKey: crypto.randomUUID(),
        },
        { authorize: async () => true },
      ),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    await env.DB.exec(
      "CREATE TRIGGER omit_manual_notice BEFORE INSERT ON notification_outbox WHEN NEW.event_type='OUT_FOR_DELIVERY' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await manageManualDelivery(deps, { ...base, action: "HAND_OVER" })).toMatchObject({
        ok: false,
      });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual({ status: "FULFILLMENT_READY" });
      expect(
        await env.DB.prepare("SELECT handed_over_at FROM delivery_provider_dispatch WHERE id=?")
          .bind(assigned.value.dispatchId)
          .first(),
      ).toEqual({ handed_over_at: null });
    } finally {
      await env.DB.exec("DROP TRIGGER omit_manual_notice");
    }
    const handedOver = await manageManualDelivery(deps, { ...base, action: "HAND_OVER" });
    expect(handedOver).toMatchObject({ ok: true, value: { version: 2 } });
    const completed = await manageManualDelivery(deps, {
      ...base,
      idempotencyKey: crypto.randomUUID(),
      action: "COMPLETE",
      expectedVersion: 2,
      actualCostMinor: null,
    });
    expect(completed).toMatchObject({ ok: true, value: { status: "COMPLETED", version: 3 } });
    expect(await manageManualDelivery(deps, request)).toEqual(assigned);
    expect(
      await manageManualDelivery(deps, { ...request, personName: "Another person" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await env.DB.prepare(
        "SELECT status,final_payable_minor,courier_variance_minor FROM delivery_provider_dispatch WHERE id=?",
      )
        .bind(assigned.value.dispatchId)
        .first(),
    ).toEqual({ status: "COMPLETED", final_payable_minor: null, courier_variance_minor: null });
    expect(
      await env.DB.prepare(
        "SELECT o.status AS order_status,f.status AS fulfillment_status,j.status AS delivery_status FROM grocery_order o JOIN fulfillment_record f ON f.order_id=o.id JOIN delivery_job j ON j.order_id=o.id WHERE o.id=?",
      )
        .bind(delivery.orderId)
        .first(),
    ).toEqual({
      order_status: "DELIVERED",
      fulfillment_status: "COMPLETED",
      delivery_status: "DELIVERED",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE aggregate_id=?")
        .bind(assigned.value.dispatchId)
        .first(),
    ).toEqual({ n: 3 });
    const notices = await env.DB.prepare(
      "SELECT event_type,status FROM notification_outbox WHERE aggregate_id=? ORDER BY event_type",
    )
      .bind(delivery.orderId)
      .all();
    expect(notices.results).toEqual([
      { event_type: "DELIVERED", status: "PENDING" },
      { event_type: "OUT_FOR_DELIVERY", status: "PENDING" },
    ]);
  });

  it("rolls back every assignment effect when its audit is omitted, and revalidates current permission", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const delivery = await seedScheduledDelivery(Date.now());
    const request = assign(delivery.jobId);
    await env.DB.exec(
      "CREATE TRIGGER omit_manual_audit BEFORE INSERT ON audit_event WHEN NEW.action='DELIVERY.MANUAL_ASSIGN' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect(await manageManualDelivery(deps, request)).toMatchObject({
        ok: false,
        error: { code: "STALE_VERSION" },
      });
    } finally {
      await env.DB.exec("DROP TRIGGER omit_manual_audit");
    }
    expect(
      await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ status: "UNASSIGNED", version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM idempotency_records WHERE scope='delivery.manual' AND idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ n: 0 });
    await env.DB.prepare(
      "DELETE FROM role_permission WHERE role_id='role-delivery-test' AND permission_id=(SELECT id FROM permission WHERE code='delivery.manage')",
    ).run();
    expect(await manageManualDelivery(deps, request)).toMatchObject({
      ok: false,
      error: { code: "STALE_VERSION" },
    });
  });

  it.each([false, true])(
    "records failure without an automatic refund (handed over: %s)",
    async (afterHandover) => {
      const deps = dependencies(["delivery.read", "delivery.manage"]);
      const delivery = await seedScheduledDelivery(Date.now());
      const request = assign(delivery.jobId);
      const assigned = await manageManualDelivery(deps, request);
      if (!assigned.ok) throw new Error("Assignment failed");
      if (afterHandover) {
        // Seed the existing packing boundary; exercise actual handover and failure commands.
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE fulfillment_record SET status='PACKED',version=version+1 WHERE order_id=?",
          ).bind(delivery.orderId),
          env.DB.prepare(
            "UPDATE grocery_order SET status='FULFILLMENT_READY',version=version+1 WHERE id=?",
          ).bind(delivery.orderId),
        ]);
        expect(
          await manageManualDelivery(deps, {
            ...request,
            action: "HAND_OVER",
            dispatchId: assigned.value.dispatchId,
            idempotencyKey: crypto.randomUUID(),
          }),
        ).toMatchObject({ ok: true, value: { version: 2 } });
      }
      const financialCounts = () =>
        env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM order_cancellation) AS cancellations,
      (SELECT COUNT(*) FROM refund) AS refunds,
      (SELECT COUNT(*) FROM payment_refund) AS payment_refunds`).first();
      const financialBefore = await financialCounts();
      const custodyBefore = await env.DB.prepare(
        "SELECT status,version FROM fulfillment_record WHERE order_id=?",
      )
        .bind(delivery.orderId)
        .first();
      const handoverBefore = await env.DB.prepare(
        "SELECT handed_over_at FROM delivery_provider_dispatch WHERE id=?",
      )
        .bind(assigned.value.dispatchId)
        .first<{ handed_over_at: number | null }>();
      await env.DB.prepare("UPDATE grocery_order SET delivery_subtotal_minor=500 WHERE id=?")
        .bind(delivery.orderId)
        .run();
      const failed = await manageManualDelivery(deps, {
        ...request,
        action: "FAIL",
        expectedVersion: afterHandover ? 2 : 1,
        dispatchId: assigned.value.dispatchId,
        reason: afterHandover
          ? "Recipient unavailable; responsibility not yet reviewed"
          : "Vehicle unavailable before handover",
        actualCostMinor: 2500,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(failed).toMatchObject({
        ok: true,
        value: { status: "FAILED", version: afterHandover ? 3 : 2 },
      });
      expect(await financialCounts()).toEqual(financialBefore);
      expect(
        await env.DB.prepare("SELECT status,version FROM fulfillment_record WHERE order_id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual(custodyBefore);
      expect(
        await env.DB.prepare(
          "SELECT status,final_payable_minor,handed_over_at,completed_at FROM delivery_provider_dispatch WHERE id=?",
        )
          .bind(assigned.value.dispatchId)
          .first(),
      ).toEqual({
        status: "FAILED",
        final_payable_minor: 2500,
        handed_over_at: handoverBefore?.handed_over_at,
        completed_at: null,
      });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual({ status: afterHandover ? "OUT_FOR_DELIVERY" : "COMMITTED" });
      expect(
        await env.DB.prepare(
          "SELECT customer_delivery_charge_minor,courier_variance_minor,delivery_currency FROM delivery_provider_dispatch WHERE id=?",
        )
          .bind(assigned.value.dispatchId)
          .first(),
      ).toEqual({
        customer_delivery_charge_minor: 500,
        courier_variance_minor: 2000,
        delivery_currency: "PHP",
      });
    },
  );

  it("admits only one of two different assignments", async () => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const delivery = await seedScheduledDelivery(Date.now());
    const results = await Promise.all([
      manageManualDelivery(deps, assign(delivery.jobId)),
      manageManualDelivery(deps, assign(delivery.jobId)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ n: 1 });
  });

  it.each([
    "delivery_job",
    "delivery_stop",
    "delivery_provider_dispatch",
    "idempotency_records",
  ] as const)("rolls back when the required %s assignment effect is omitted", async (table) => {
    const deps = dependencies(["delivery.read", "delivery.manage"]);
    const delivery = await seedScheduledDelivery(Date.now());
    const request = assign(delivery.jobId);
    const operation = table === "delivery_provider_dispatch" ? "INSERT" : "UPDATE";
    await env.DB.exec(
      `CREATE TRIGGER omit_manual_effect BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
    );
    try {
      expect((await manageManualDelivery(deps, request)).ok).toBe(false);
    } finally {
      await env.DB.exec("DROP TRIGGER omit_manual_effect");
    }
    expect(
      await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ status: "UNASSIGNED", version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM delivery_provider_dispatch WHERE delivery_job_id=?",
      )
        .bind(delivery.jobId)
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM idempotency_records WHERE scope='delivery.manual' AND idempotency_key=?",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ n: 0 });
  });
});

describe("customer-agreed delivery times", () => {
  it.each(["INSTANT", "SCHEDULED"] as const)(
    "preserves the paid %s promise and atomically enables a later retry",
    async (mode) => {
      const now = Date.now();
      const deps = { ...dependencies(["delivery.read", "delivery.manage"]), now: () => now };
      await upsertLocationDeliveryProfile(deps, profileRequest(0));
      const delivery = await seedScheduledDelivery(now, mode);
      await env.DB.prepare("UPDATE delivery_job SET promised_at=? WHERE id=?")
        .bind(now + 3600000, delivery.jobId)
        .run();
      if (mode === "SCHEDULED") await receiveScheduledTestGoods(delivery, now);
      else
        for (const [index, action] of (
          ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
        ).entries()) {
          expect(
            await advanceFulfillment(
              env.DB,
              {
                headers: {},
                requestId: crypto.randomUUID(),
                orderId: delivery.orderId,
                action,
                expectedVersion: index + 1,
                idempotencyKey: crypto.randomUUID(),
              },
              { authorize: async () => true },
            ),
          ).toMatchObject({ ok: true });
        }
      const provider = createMockDeliveryProvider(() => now);
      const bookingDeps = { ...deps, provider, configuredServiceType: "MOTORCYCLE" };
      const booking = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        jobId: delivery.jobId,
        expectedVersion: 1,
        providerCode: "lalamove" as const,
        pickup:
          mode === "SCHEDULED"
            ? { kind: "SCHEDULED" as const, pickupAt: new Date(now + 600000).toISOString() }
            : { kind: "IMMEDIATE" as const },
        idempotencyKey: crypto.randomUUID(),
      };
      const first = await requestExternalDelivery(bookingDeps, booking);
      if (!first.ok) throw new Error(first.error.message);
      const agreement = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        jobId: delivery.jobId,
        expectedVersion: 1,
        promisedAt: new Date(now + 3 * 86400000).toISOString(),
        agreementNote: "Customer agreed by phone to the new delivery time",
        idempotencyKey: crypto.randomUUID(),
      };
      expect(await reviseDeliveryPromise(deps, agreement)).toMatchObject({
        ok: false,
        error: { code: "ILLEGAL_TRANSITION" },
      });
      expect(
        await cancelExternalDelivery(bookingDeps, {
          headers: {},
          requestId: crypto.randomUUID(),
          locationId: LOCATION,
          dispatchId: first.value.dispatchId,
          expectedVersion: first.value.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
      const job = await env.DB.prepare("SELECT version,promised_at FROM delivery_job WHERE id=?")
        .bind(delivery.jobId)
        .first<{ version: number; promised_at: number }>();
      if (!job) throw new Error("Missing delivery");
      const request = { ...agreement, expectedVersion: job.version };
      await env.DB.prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) SELECT c.auth_user_id,'Test customer',c.id || '@example.com',1,?,? FROM customer c JOIN grocery_order o ON o.customer_id=c.id WHERE o.id=?",
      )
        .bind(now, now, delivery.orderId)
        .run();
      await env.DB.prepare("UPDATE grocery_order SET committed_at=? WHERE id=?")
        .bind(now, delivery.orderId)
        .run();
      await projectDomainNotifications(env.DB, now);
      const failureNotifications = await env.DB.prepare(
        "SELECT id FROM notification_outbox WHERE aggregate_id=? AND event_type='DELIVERY_FAILED'",
      )
        .bind(delivery.orderId)
        .all();
      expect(failureNotifications.results).toHaveLength(1);
      const original = await env.DB.prepare(
        "SELECT * FROM order_fulfillment_snapshot WHERE order_id=?",
      )
        .bind(delivery.orderId)
        .first();
      const paidOrder = await env.DB.prepare("SELECT * FROM grocery_order WHERE id=?")
        .bind(delivery.orderId)
        .first();
      expect(
        await reviseDeliveryPromise(
          { ...dependencies(["delivery.read"]), now: () => now },
          request,
        ),
      ).toMatchObject({ ok: false });
      expect(
        await reviseDeliveryPromise(deps, { ...request, locationId: "location-manila-central" }),
      ).toMatchObject({ ok: false });
      expect(
        await reviseDeliveryPromise({ ...deps, accessContext: undefined }, request),
      ).toMatchObject({ ok: false });
      expect(
        await reviseDeliveryPromise(deps, { ...request, promisedAt: new Date(now).toISOString() }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
      expect(await reviseDeliveryPromise(deps, { ...request, agreementNote: " " })).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_FAILED" },
      });
      await env.DB.exec(
        "CREATE TRIGGER omit_agreement_audit BEFORE INSERT ON audit_event WHEN NEW.action='DELIVERY.PROMISE_REVISED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        expect(await reviseDeliveryPromise(deps, request)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT version,promised_at FROM delivery_job WHERE id=?")
            .bind(delivery.jobId)
            .first(),
        ).toEqual(job);
        expect(
          await env.DB.prepare("SELECT id FROM delivery_promise_revision WHERE delivery_job_id=?")
            .bind(delivery.jobId)
            .first(),
        ).toBeNull();
        expect(
          await env.DB.prepare(
            "SELECT 1 FROM idempotency_records WHERE scope='delivery.promiseRevision' AND idempotency_key=?",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toBeNull();
      } finally {
        await env.DB.exec("DROP TRIGGER omit_agreement_audit");
      }
      const requests = [request, { ...request, idempotencyKey: crypto.randomUUID() }];
      const outcomes = await Promise.all(
        requests.map((input) => reviseDeliveryPromise(deps, input)),
      );
      expect(outcomes.filter((item) => item.ok)).toHaveLength(1);
      const winner = outcomes.findIndex((item) => item.ok);
      const winningRequest = requests[winner];
      const winningResult = outcomes[winner];
      if (!winningRequest || !winningResult?.ok) throw new Error("Missing agreement winner");
      expect(
        await reviseDeliveryPromise({ ...deps, now: () => now + 4 * 86400000 }, winningRequest),
      ).toEqual(winningResult);
      expect(
        await reviseDeliveryPromise(deps, {
          ...winningRequest,
          agreementNote: "Changed agreement",
        }),
      ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
      expect(
        await env.DB.prepare("SELECT * FROM order_fulfillment_snapshot WHERE order_id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual(original);
      expect(
        await env.DB.prepare("SELECT * FROM grocery_order WHERE id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual(paidOrder);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM delivery_promise_revision WHERE delivery_job_id=?",
          )
            .bind(delivery.jobId)
            .first<{ count: number }>()
        )?.count,
      ).toBe(1);
      await expect(
        env.DB.prepare(
          "UPDATE delivery_promise_revision SET agreement_note='changed' WHERE delivery_job_id=?",
        )
          .bind(delivery.jobId)
          .run(),
      ).rejects.toThrow("IMMUTABLE_DELIVERY_AGREEMENT");
      await expect(
        env.DB.prepare("DELETE FROM delivery_promise_revision WHERE delivery_job_id=?")
          .bind(delivery.jobId)
          .run(),
      ).rejects.toThrow("IMMUTABLE_DELIVERY_AGREEMENT");
      await projectDomainNotifications(env.DB, now + 1000);
      expect(
        (
          await env.DB.prepare(
            "SELECT id FROM notification_outbox WHERE aggregate_id=? AND event_type='DELIVERY_FAILED'",
          )
            .bind(delivery.orderId)
            .all()
        ).results,
      ).toEqual(failureNotifications.results);
      const later = now + 2 * 86400000;
      const retried = await requestExternalDelivery(
        { ...bookingDeps, now: () => later },
        {
          ...booking,
          expectedVersion: winningResult.value.version,
          pickup:
            mode === "SCHEDULED"
              ? { kind: "SCHEDULED", pickupAt: new Date(later + 600000).toISOString() }
              : { kind: "IMMEDIATE" },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      expect(retried).toMatchObject({ ok: true });
      expect(
        await reviseDeliveryPromise(deps, {
          ...request,
          expectedVersion: winningResult.value.version + 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false });
    },
  );
});

describe("inspected physical-return recovery", () => {
  it.each(["SCHEDULED", "INSTANT"] as const)(
    "restores %s custody once without restocking or reusing an earlier inspection",
    async (mode) => {
      let clock = Date.now();
      const deps = { ...dependencies(["delivery.read", "delivery.manage"]), now: () => clock };
      const delivery = await seedScheduledDelivery(clock, mode);
      await upsertLocationDeliveryProfile(deps, profileRequest(0));
      await env.DB.prepare("UPDATE delivery_job SET promised_at=? WHERE id=?")
        .bind(clock + 3600000, delivery.jobId)
        .run();
      if (mode === "SCHEDULED") await receiveScheduledTestGoods(delivery, clock);
      else
        expect(
          await advanceFulfillment(
            env.DB,
            {
              headers: {},
              requestId: crypto.randomUUID(),
              orderId: delivery.orderId,
              action: "START_PICKING",
              expectedVersion: 1,
              idempotencyKey: crypto.randomUUID(),
            },
            { authorize: async () => true },
          ),
        ).toMatchObject({ ok: true });
      for (const [index, action] of (["MARK_READY_TO_PACK", "START_PACKING"] as const).entries()) {
        expect(
          await advanceFulfillment(
            env.DB,
            {
              headers: {},
              requestId: crypto.randomUUID(),
              orderId: delivery.orderId,
              action,
              expectedVersion: index + 2,
              idempotencyKey: crypto.randomUUID(),
            },
            { authorize: async () => true },
          ),
        ).toMatchObject({ ok: true });
      }
      if (mode === "SCHEDULED") {
        // Real receiving and packing consumption precede manual custody and return.
        expect(
          await advanceFulfillment(
            env.DB,
            {
              headers: {},
              requestId: crypto.randomUUID(),
              orderId: delivery.orderId,
              action: "MARK_PACKED",
              expectedVersion: 4,
              idempotencyKey: crypto.randomUUID(),
            },
            { authorize: async () => true },
          ),
        ).toMatchObject({ ok: true });
      } else {
        // Instant packing/paid reservation acceptance is covered by the browser journey;
        // seed that boundary here to exercise actual external pickup/return commands.
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE fulfillment_record SET status='PACKED',version=version+1 WHERE order_id=?",
          ).bind(delivery.orderId),
          env.DB.prepare(
            "UPDATE grocery_order SET status='FULFILLMENT_READY',version=version+1 WHERE id=?",
          ).bind(delivery.orderId),
        ]);
      }
      const currentJob = async () => {
        const row = await env.DB.prepare("SELECT status,version FROM delivery_job WHERE id=?")
          .bind(delivery.jobId)
          .first<{ status: string; version: number }>();
        if (!row) throw new Error("Missing delivery");
        return row;
      };
      const latestAttempt = async () => {
        const row = await env.DB.prepare(
          "SELECT id,version,merchant_order_id,provider_delivery_id FROM delivery_provider_dispatch WHERE delivery_job_id=? ORDER BY attempt_sequence DESC LIMIT 1",
        )
          .bind(delivery.jobId)
          .first<{
            id: string;
            version: number;
            merchant_order_id: string;
            provider_delivery_id: string | null;
          }>();
        if (!row) throw new Error("Missing attempt");
        return row;
      };
      let providerStatus: "IN_DELIVERY" | "RETURNED" = "IN_DELIVERY";
      const provider: DeliveryProvider = {
        ...createMockDeliveryProvider(() => clock),
        get: async () => {
          const attempt = await latestAttempt();
          return {
            ok: true,
            value: {
              providerDeliveryId: attempt.provider_delivery_id ?? "missing-provider",
              merchantOrderId: attempt.merchant_order_id,
              status: providerStatus,
              trackingUrl: null,
              pickupPin: null,
              quote: null,
            },
          };
        },
      };
      const bookingDeps = { ...deps, provider, configuredServiceType: "MOTORCYCLE" };
      async function sendAndFail() {
        const job = await currentJob();
        if (mode === "SCHEDULED") {
          const assigned = await manageManualDelivery(deps, {
            headers: {},
            requestId: crypto.randomUUID(),
            locationId: LOCATION,
            jobId: delivery.jobId,
            expectedVersion: job.version,
            idempotencyKey: crypto.randomUUID(),
            action: "ASSIGN",
            personName: "Delivery helper",
            phoneE164: "+639171110000",
            reason: "Customer agreed to manual delivery",
          });
          if (!assigned.ok) throw new Error(assigned.error.message);
          const handover = await manageManualDelivery(deps, {
            headers: {},
            requestId: crypto.randomUUID(),
            locationId: LOCATION,
            jobId: delivery.jobId,
            expectedVersion: assigned.value.version,
            dispatchId: assigned.value.dispatchId,
            idempotencyKey: crypto.randomUUID(),
            action: "HAND_OVER",
          });
          if (!handover.ok) throw new Error(handover.error.message);
          expect(
            await manageManualDelivery(deps, {
              headers: {},
              requestId: crypto.randomUUID(),
              locationId: LOCATION,
              jobId: delivery.jobId,
              expectedVersion: handover.value.version,
              dispatchId: assigned.value.dispatchId,
              idempotencyKey: crypto.randomUUID(),
              action: "FAIL",
              actualCostMinor: null,
              reason: "Delivery failed; goods brought back for review",
            }),
          ).toMatchObject({ ok: true });
        } else {
          expect(
            await requestExternalDelivery(bookingDeps, {
              headers: {},
              requestId: crypto.randomUUID(),
              locationId: LOCATION,
              jobId: delivery.jobId,
              expectedVersion: job.version,
              idempotencyKey: crypto.randomUUID(),
              providerCode: "lalamove",
              pickup: { kind: "IMMEDIATE" },
            }),
          ).toMatchObject({ ok: true });
          for (const status of ["IN_DELIVERY", "RETURNED"] as const) {
            providerStatus = status;
            clock++;
            const attempt = await latestAttempt();
            expect(
              await refreshExternalDelivery(bookingDeps, {
                headers: {},
                requestId: crypto.randomUUID(),
                locationId: LOCATION,
                dispatchId: attempt.id,
                expectedVersion: attempt.version,
                idempotencyKey: crypto.randomUUID(),
              }),
            ).toMatchObject({ ok: true });
          }
        }
      }
      await sendAndFail();
      const firstAttempt = await latestAttempt();
      const failed = await currentJob();
      expect(failed.status).toBe("FAILED");
      const stockAndMoney = () =>
        env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM inventory_ledger_entries WHERE reference_id=?) AS inventory_events,
      (SELECT SUM(on_hand) FROM inventory_balance) AS on_hand,
      (SELECT SUM(reserved) FROM inventory_balance) AS reserved,
      (SELECT SUM(packed_base) FROM cycle_goods_balance) AS packed,
      (SELECT COUNT(*) FROM cycle_goods_movement WHERE order_id=?) AS cycle_events,
      (SELECT COUNT(*) FROM order_cancellation) AS cancellations,
      (SELECT COUNT(*) FROM refund) AS refunds,(SELECT COUNT(*) FROM payment_refund) AS payment_refunds`)
          .bind(delivery.orderId, delivery.orderId)
          .first();
      const unchanged = await stockAndMoney();
      const request = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        jobId: delivery.jobId,
        expectedVersion: failed.version,
        idempotencyKey: crypto.randomUUID(),
        promisedAt: new Date(clock + 2 * 3600000).toISOString(),
        agreementNote: "Customer agreed by phone to another delivery",
        returnInspection: {
          allGoodsSuitableAndPacked: true as const,
          note: "All groceries physically returned, checked and packed for the same customer",
        },
      };
      expect(
        await reviseDeliveryPromise(deps, { ...request, returnInspection: undefined }),
      ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
      expect(
        await reviseDeliveryPromise(deps, {
          ...request,
          returnInspection: { ...request.returnInspection, note: " " },
        }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
      const queueRequest = {
        headers: {},
        requestId: crypto.randomUUID(),
        locationId: LOCATION,
        limit: 100,
      };
      const beforeQueue = await listAdminDeliveryOperations(deps, queueRequest);
      if (!beforeQueue.ok) throw new Error(beforeQueue.error.message);
      expect(beforeQueue.value.items.find((item) => item.jobId === delivery.jobId)).toMatchObject({
        canInspectReturnedGoods: true,
        canRevisePromise: false,
        manualActions: [],
      });
      await env.DB.exec(
        "CREATE TRIGGER omit_return_custody BEFORE UPDATE ON fulfillment_record WHEN NEW.status='PACKED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        expect(await reviseDeliveryPromise(deps, request)).toMatchObject({ ok: false });
        expect(await currentJob()).toEqual(failed);
        expect(
          await env.DB.prepare("SELECT id FROM delivery_promise_revision WHERE delivery_job_id=?")
            .bind(delivery.jobId)
            .first(),
        ).toBeNull();
        expect(
          await env.DB.prepare(
            "SELECT 1 FROM idempotency_records WHERE scope='delivery.promiseRevision' AND idempotency_key=?",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toBeNull();
      } finally {
        await env.DB.exec("DROP TRIGGER omit_return_custody");
      }
      const requests = [request, { ...request, idempotencyKey: crypto.randomUUID() }];
      const outcomes = await Promise.all(
        requests.map((input) => reviseDeliveryPromise(deps, input)),
      );
      expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
      const winner = outcomes.findIndex((result) => result.ok);
      const winnerRequest = requests[winner];
      const winnerResult = outcomes[winner];
      if (!winnerRequest || !winnerResult?.ok) throw new Error("Missing inspection winner");
      expect(await stockAndMoney()).toEqual(unchanged);
      expect(
        await env.DB.prepare("SELECT status FROM fulfillment_record WHERE order_id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual({ status: "PACKED" });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
          .bind(delivery.orderId)
          .first(),
      ).toEqual({ status: "FULFILLMENT_READY" });
      const afterQueue = await listAdminDeliveryOperations(deps, queueRequest);
      if (!afterQueue.ok) throw new Error(afterQueue.error.message);
      expect(afterQueue.value.items.find((item) => item.jobId === delivery.jobId)).toMatchObject({
        canInspectReturnedGoods: false,
        canRevisePromise: true,
        manualActions: mode === "SCHEDULED" ? ["ASSIGN"] : [],
      });
      expect(
        await env.DB.prepare(
          "SELECT dispatch_id,return_inspection_note,return_inspected_at FROM delivery_promise_revision WHERE id=?",
        )
          .bind(winnerResult.value.revisionId)
          .first(),
      ).toMatchObject({
        dispatch_id: firstAttempt.id,
        return_inspection_note: request.returnInspection.note,
        return_inspected_at: clock,
      });
      await sendAndFail();
      expect((await latestAttempt()).id).not.toBe(firstAttempt.id);
      const failedAgain = await currentJob();
      expect(await reviseDeliveryPromise(deps, winnerRequest)).toEqual(winnerResult);
      expect(await currentJob()).toEqual(failedAgain);
      expect(
        await reviseDeliveryPromise(deps, {
          ...request,
          expectedVersion: failedAgain.version,
          idempotencyKey: crypto.randomUUID(),
          returnInspection: undefined,
        }),
      ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
      expect(await stockAndMoney()).toEqual(unchanged);
    },
  );
});
