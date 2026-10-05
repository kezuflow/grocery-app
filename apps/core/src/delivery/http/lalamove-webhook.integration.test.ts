import { lookupProviderDeliveries } from "../application/lookup-provider-deliveries";
import { createMockDeliveryProvider } from "../infrastructure/mock-delivery-provider";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleLalamoveWebhook } from "./lalamove-webhook";
import { reconcileProviderObservations } from "../application/reconcile-provider-observations";
import { projectDomainNotifications } from "../../notifications/application/project-domain-notifications";
import { deliverNotificationById } from "../../notifications/application/deliver-notifications";

const credentials = {
  DELIVERY_PROVIDERS: "lalamove",
  LALAMOVE_API_KEY: "pk_test_freshmarkets",
  LALAMOVE_API_SECRET: "sk_test_freshmarkets",
} as const;

function payload(options: { eventId?: string; status?: string; updatedAt?: string } = {}) {
  return {
    apiKey: credentials.LALAMOVE_API_KEY,
    timestamp: "1788483600000",
    signature: "pending",
    eventId: options.eventId ?? "event-lalamove-1",
    eventType: "ORDER_STATUS_CHANGED",
    eventVersion: "v3",
    data: {
      order: {
        orderId: "1900000000000000001",
        status: options.status ?? "PICKED_UP",
        shareLink: "https://share.lalamove.com/private-order",
        stops: [{ name: "Ana Private Customer", phone: "+639171234567" }],
      },
      updatedAt: options.updatedAt ?? "2026-09-04T01:00:00.000Z",
    },
  };
}

async function signature(value: { timestamp: string; data: unknown; [key: string]: unknown }) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(credentials.LALAMOVE_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const raw = `${value.timestamp}\r\nPOST\r\n/webhooks/delivery/lalamove\r\n\r\n${JSON.stringify(value.data)}`;
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return hex;
}

async function request(
  value: { timestamp: string; data: unknown; [key: string]: unknown },
  suppliedSignature?: string,
) {
  const signed = { ...value, signature: suppliedSignature ?? (await signature(value)) };
  return new Request("https://core.example.invalid/webhooks/delivery/lalamove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed),
  });
}

async function seedDispatch(suffix = "1", providerId = "1900000000000000001") {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,'Synthetic customer',?,1,1,1)",
    ).bind(`webhook-auth-${suffix}`, `webhook-${suffix}@example.com`),
    env.DB.prepare(
      "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(`webhook-customer-${suffix}`, `webhook-auth-${suffix}`),
    env.DB.prepare(
      "INSERT INTO payment_attempt (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,20000,'PHP','SUCCEEDED','canonical',?,1,1)",
    ).bind(`webhook-payment-${suffix}`, `webhook-customer-${suffix}`, `webhook-payment-${suffix}`),
    env.DB.prepare(
      "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at) VALUES (?,?,NULL,'INSTANT','{}','FULFILLMENT_READY',20000,'PHP',?,1)",
    ).bind(
      `order-lalamove-webhook-${suffix}`,
      `webhook-customer-${suffix}`,
      `webhook-payment-${suffix}`,
    ),
    env.DB.prepare(
      "INSERT INTO fulfillment_record (id,order_id,location_id,status,updated_at) VALUES (?,?,'location-cebu-central','PACKED',1)",
    ).bind(`webhook-fulfillment-${suffix}`, `order-lalamove-webhook-${suffix}`),
  ]);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_job
     (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, status,
      context_resolution_status, address_snapshot_json, version, created_at, updated_at)
     VALUES (?, ?, NULL, 'INSTANT',
             'location-cebu-central', 'zone-cebu-city-core', 'UNASSIGNED',
             'RESOLVED', '{}', 1, 1, 1)`,
  )
    .bind(`job-lalamove-webhook-${suffix}`, `order-lalamove-webhook-${suffix}`)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_provider_dispatch
     (id, delivery_job_id, provider, merchant_order_id, provider_delivery_id,
      request_hash, request_snapshot_json, status, provider_status,
      attempt_count, version, created_at, updated_at)
     VALUES (?, ?, 'lalamove',
             ?, ?, 'request-hash',
             '{"protected":true}', 'ACTIVE', 'ALLOCATING', 1, 1, 1, 1)`,
  )
    .bind(
      `dispatch-lalamove-webhook-${suffix}`,
      `job-lalamove-webhook-${suffix}`,
      `FM-LALAMOVE-WEBHOOK-${suffix}`,
      providerId,
    )
    .run();
}

describe("Lalamove tracking webhook", () => {
  it("retains an unavailable-recipient notice without losing the verified pickup or attempting a send", async () => {
    await seedDispatch("no-recipient", "1900000000000000021");
    await env.DB.prepare("DELETE FROM user WHERE id='webhook-auth-no-recipient'").run();
    const event = payload({ eventId: "no-recipient-pickup" });
    event.data.order.orderId = "1900000000000000021";
    expect(
      (await handleLalamoveWebhook(env.DB, credentials, await request(event), crypto.randomUUID()))
        .status,
    ).toBe(200);
    const notice = await env.DB.prepare(
      "SELECT id,status,last_error_code FROM notification_outbox WHERE aggregate_id='order-lalamove-webhook-no-recipient'",
    ).first<{ id: string; status: string; last_error_code: string }>();
    expect(notice).toMatchObject({ status: "FAILED", last_error_code: "RECIPIENT_UNAVAILABLE" });
    if (!notice) throw new Error("Missing retained notification intent");
    let sends = 0;
    await deliverNotificationById(
      env.DB,
      {
        async send() {
          sends++;
          return { ok: true };
        },
      },
      notice.id,
      Date.now(),
    );
    expect(sends).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-no-recipient'",
      ).first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY" });
  });
  it("commits pickup and completion notices before projection, with rollback and duplicate-safe recovery", async () => {
    await seedDispatch("notices", "1900000000000000020");
    const pickup = payload({ eventId: "notices-pickup", status: "PICKED_UP" });
    pickup.data.order.orderId = "1900000000000000020";
    const send = async (event: ReturnType<typeof payload>) =>
      handleLalamoveWebhook(env.DB, credentials, await request(event), crypto.randomUUID());
    const notices = () =>
      env.DB.prepare(
        "SELECT id,event_type,status,scheduled_at FROM notification_outbox WHERE aggregate_id='order-lalamove-webhook-notices' ORDER BY scheduled_at,event_type",
      ).all<{ id: string; event_type: string; status: string; scheduled_at: number }>();
    await env.DB.exec(
      "CREATE TRIGGER omit_delivery_notice BEFORE INSERT ON notification_outbox WHEN NEW.event_type='OUT_FOR_DELIVERY' BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      expect((await send(pickup)).status).toBe(202);
      expect((await notices()).results).toEqual([]);
      expect(
        await env.DB.prepare(
          "SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-notices'",
        ).first(),
      ).toEqual({ status: "FULFILLMENT_READY" });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')='notices-pickup'",
        ).first(),
      ).toEqual({ processing_status: "RECONCILIATION_REQUIRED" });
    } finally {
      await env.DB.exec("DROP TRIGGER omit_delivery_notice");
    }
    expect((await send(pickup)).status).toBe(200);
    expect((await send(pickup)).status).toBe(200);
    const completed = payload({
      eventId: "notices-completed",
      status: "COMPLETED",
      updatedAt: "2026-09-04T02:00:00Z",
    });
    completed.data.order.orderId = pickup.data.order.orderId;
    expect((await send(completed)).status).toBe(200);
    const before = (await notices()).results;
    expect(before.map((row) => [row.event_type, row.status])).toEqual([
      ["OUT_FOR_DELIVERY", "PENDING"],
      ["DELIVERED", "PENDING"],
    ]);
    await projectDomainNotifications(env.DB, Date.now());
    expect((await notices()).results).toEqual(before);
    let sends = 0;
    for (const notice of before) {
      const port = {
        async send() {
          sends++;
          return { ok: true as const };
        },
      };
      await deliverNotificationById(env.DB, port, notice.id, Date.now());
      await deliverNotificationById(env.DB, port, notice.id, Date.now());
    }
    expect(sends).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-notices'",
      ).first(),
    ).toEqual({ status: "DELIVERED" });
    expect(
      await env.DB.prepare(
        "SELECT status FROM fulfillment_record WHERE id='webhook-fulfillment-notices'",
      ).first(),
    ).toEqual({ status: "COMPLETED" });
    expect(
      await env.DB.prepare(
        "SELECT handed_over_at,completed_at FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-notices'",
      ).first(),
    ).toEqual({
      handed_over_at: Date.parse("2026-09-04T01:00:00.000Z"),
      completed_at: Date.parse("2026-09-04T02:00:00Z"),
    });
  });
  it("bounds background retries and preserves unresolved early pickup evidence", async () => {
    await seedDispatch("bounded", "1900000000000000008");
    await env.DB.prepare(
      "UPDATE fulfillment_record SET status='PACKING' WHERE id='webhook-fulfillment-bounded'",
    ).run();
    const event = payload({ eventId: "bounded-pickup-recovery" });
    event.data.order.orderId = "1900000000000000008";
    expect(
      (await handleLalamoveWebhook(env.DB, credentials, await request(event), crypto.randomUUID()))
        .status,
    ).toBe(202);
    const now = Date.now();
    for (let index = 0; index < 7; index += 1)
      await reconcileProviderObservations(env.DB, now + index * 2_000_000);
    expect(
      await env.DB.prepare(
        "SELECT recovery_attempts,processing_status,last_error_code FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(event.eventId)
        .first(),
    ).toEqual({
      recovery_attempts: 5,
      processing_status: "RECONCILIATION_REQUIRED",
      last_error_code: "DELIVERY_PACKING_NOT_COMPLETE",
    });
    expect(
      await env.DB.prepare(
        "SELECT status FROM delivery_job WHERE id='job-lalamove-webhook-bounded'",
      ).first(),
    ).toEqual({ status: "UNASSIGNED" });
  });

  it("does not regress pickup or reopen completed delivery from newer conflicting evidence", async () => {
    await seedDispatch("regression", "1900000000000000009");
    const send = async (eventId: string, status: string, updatedAt: string) => {
      const event = payload({ eventId, status, updatedAt });
      event.data.order.orderId = "1900000000000000009";
      return handleLalamoveWebhook(env.DB, credentials, await request(event), crypto.randomUUID());
    };
    expect((await send("regression-pickup", "PICKED_UP", "2026-09-04T01:00:00Z")).status).toBe(200);
    expect((await send("regression-assigned", "ON_GOING", "2026-09-04T02:00:00Z")).status).toBe(
      202,
    );
    expect(
      await env.DB.prepare(
        "SELECT status FROM delivery_job WHERE id='job-lalamove-webhook-regression'",
      ).first(),
    ).toEqual({ status: "EN_ROUTE" });
    expect((await send("regression-completed", "COMPLETED", "2026-09-04T03:00:00Z")).status).toBe(
      200,
    );
    expect((await send("regression-canceled", "CANCELED", "2026-09-04T04:00:00Z")).status).toBe(
      202,
    );
    expect(
      (await send("regression-same-time-canceled", "CANCELED", "2026-09-04T03:00:00Z")).status,
    ).toBe(202);
    expect(
      await env.DB.prepare(
        "SELECT status FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-regression'",
      ).first(),
    ).toEqual({ status: "COMPLETED" });
    expect(
      await env.DB.prepare(
        "SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-regression'",
      ).first(),
    ).toEqual({ status: "DELIVERED" });
  });

  it("retains early pickup for reconciliation and projects the owning Order only after packing", async () => {
    await seedDispatch("early", "1900000000000000006");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE fulfillment_record SET status='PACKING' WHERE id='webhook-fulfillment-early'",
      ),
      env.DB.prepare(
        "UPDATE grocery_order SET status='FULFILLMENT_PENDING' WHERE id='order-lalamove-webhook-early'",
      ),
    ]);
    const event = payload({ eventId: "early-provider-pickup" });
    event.data.order.orderId = "1900000000000000006";
    const first = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(first.status).toBe(202);
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM grocery_order WHERE id='order-lalamove-webhook-early'",
      ).first(),
    ).toEqual({ status: "FULFILLMENT_PENDING", version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM delivery_job WHERE id='job-lalamove-webhook-early'",
      ).first(),
    ).toEqual({ status: "UNASSIGNED", version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT processing_status,last_error_code FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(event.eventId)
        .first(),
    ).toEqual({
      processing_status: "RECONCILIATION_REQUIRED",
      last_error_code: "DELIVERY_PACKING_NOT_COMPLETE",
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE fulfillment_record SET status='PACKED' WHERE id='webhook-fulfillment-early'",
      ),
      env.DB.prepare(
        "UPDATE grocery_order SET status='FULFILLMENT_READY' WHERE id='order-lalamove-webhook-early'",
      ),
    ]);
    const retry = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(retry.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM grocery_order WHERE id='order-lalamove-webhook-early'",
      ).first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY", version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT status FROM fulfillment_record WHERE id='webhook-fulfillment-early'",
      ).first(),
    ).toEqual({ status: "HANDED_OFF" });
  });
  it("applies a concurrent duplicate once and ignores an older observation", async () => {
    await seedDispatch("race", "1900000000000000005");
    const event = payload({ eventId: "concurrent-delivery-event" });
    event.data.order.orderId = "1900000000000000005";
    const requests = await Promise.all([request(event), request(event)]);
    const responses = await Promise.all(
      requests.map((incoming) =>
        handleLalamoveWebhook(env.DB, credentials, incoming, crypto.randomUUID()),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const older = payload({
      eventId: "older-delivery-event",
      status: "ON_GOING",
      updatedAt: "2026-09-04T00:00:00.000Z",
    });
    older.data.order.orderId = event.data.order.orderId;
    const ignored = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(older),
      crypto.randomUUID(),
    );
    expect(await ignored.json()).toMatchObject({ ignoredAsOlder: true });
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM delivery_job WHERE id='job-lalamove-webhook-race'",
      ).first(),
    ).toEqual({ status: "EN_ROUTE", version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT provider_status,version FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-race'",
      ).first(),
    ).toEqual({ provider_status: "IN_DELIVERY", version: 2 });
  });

  it("rolls back every projection on failure and applies the persisted inbox event on retry", async () => {
    await seedDispatch("retry", "1900000000000000003");
    await env.DB.prepare(`CREATE TRIGGER reject_webhook_job_update BEFORE UPDATE ON delivery_job
      WHEN NEW.id='job-lalamove-webhook-retry' BEGIN SELECT RAISE(ABORT,'test projection failure'); END`).run();
    const event = payload({ eventId: "retry-after-projection-failure" });
    event.data.order.orderId = "1900000000000000003";
    try {
      await expect(
        handleLalamoveWebhook(env.DB, credentials, await request(event), crypto.randomUUID()),
      ).rejects.toThrow("test projection failure");
      expect(
        await env.DB.prepare(
          "SELECT provider_status,version FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-retry'",
        ).first(),
      ).toEqual({ provider_status: "ALLOCATING", version: 1 });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
        )
          .bind(event.eventId)
          .first(),
      ).toEqual({ processing_status: "RECEIVED" });
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_webhook_job_update").run();
    }
    const retried = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(retried.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM delivery_job WHERE id='job-lalamove-webhook-retry'",
      ).first(),
    ).toEqual({ status: "EN_ROUTE", version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(event.eventId)
        .first(),
    ).toEqual({ processing_status: "APPLIED" });
  });

  it("retries an event received before its dispatch exists", async () => {
    const event = payload({ eventId: "dispatch-created-after-event" });
    event.data.order.orderId = "1900000000000000004";
    const first = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(await first.json()).toMatchObject({ reconciliationRequired: true });
    await seedDispatch("late", "1900000000000000004");
    await reconcileProviderObservations(env.DB, Date.now());
    expect(
      await env.DB.prepare(
        "SELECT processing_status,dispatch_id FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(event.eventId)
        .first(),
    ).toEqual({ processing_status: "APPLIED", dispatch_id: "dispatch-lalamove-webhook-late" });
    const retried = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(retried.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM delivery_job WHERE id='job-lalamove-webhook-late'",
      ).first(),
    ).toEqual({ status: "EN_ROUTE", version: 2 });
  });

  it("does not cancel the paid grocery Order when the courier cancels", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES ('courier-cancel-customer','courier-cancel-auth','active',1,1)",
      ),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES ('courier-cancel-payment','courier-cancel-customer',20000,'PHP','SUCCEEDED','canonical','courier-cancel-payment',1,1)",
      ),
      env.DB.prepare(
        "INSERT INTO grocery_order (id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at) VALUES ('order-courier-cancellation','courier-cancel-customer',NULL,'INSTANT','{}','COMMITTED',20000,'PHP','courier-cancel-payment',1)",
      ),
      env.DB.prepare(
        "INSERT INTO delivery_job (id,order_id,fulfillment_mode,location_id,zone_id,status,context_resolution_status,address_snapshot_json,created_at,updated_at) VALUES ('job-courier-cancellation','order-courier-cancellation','INSTANT','location-cebu-central','zone-cebu-city-core','UNASSIGNED','RESOLVED','{}',1,1)",
      ),
      env.DB.prepare(
        "INSERT INTO delivery_provider_dispatch (id,delivery_job_id,provider,merchant_order_id,provider_delivery_id,request_hash,request_snapshot_json,status,provider_status,attempt_count,version,created_at,updated_at) VALUES ('dispatch-courier-cancellation','job-courier-cancellation','lalamove','order-courier-cancellation','1900000000000000002','cancel-hash','{}','ACTIVE','ALLOCATING',1,1,1,1)",
      ),
    ]);
    const event = payload({ eventId: "courier-canceled", status: "CANCELED" });
    event.data.order.orderId = "1900000000000000002";
    const response = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT status,version FROM grocery_order WHERE id='order-courier-cancellation'",
      ).first(),
    ).toEqual({ status: "COMMITTED", version: 1 });
    expect(
      await env.DB.prepare(
        "SELECT status FROM delivery_provider_dispatch WHERE id='dispatch-courier-cancellation'",
      ).first(),
    ).toEqual({ status: "CANCELED" });
    expect(
      await env.DB.prepare(
        "SELECT status FROM delivery_job WHERE id='job-courier-cancellation'",
      ).first(),
    ).toEqual({ status: "FAILED" });
    expect(
      await env.DB.prepare(
        "SELECT id FROM order_cancellation WHERE order_id='order-courier-cancellation'",
      ).first(),
    ).toBeNull();
  });

  it("acknowledges Lalamove's headerless empty registration probe", async () => {
    const request = new Request("https://core.example.invalid/webhooks/delivery/lalamove", {
      method: "POST",
      body: new Uint8Array(0),
    });
    expect(request.body).not.toBeNull();
    expect(request.headers.get("content-type")).toBeNull();
    const response = await handleLalamoveWebhook(env.DB, credentials, request, crypto.randomUUID());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connectionCheck: true });
  });

  it("acknowledges Lalamove's empty JSON object registration probe", async () => {
    const response = await handleLalamoveWebhook(
      env.DB,
      credentials,
      new Request("https://core.example.invalid/webhooks/delivery/lalamove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      crypto.randomUUID(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, connectionCheck: true });
  });

  it("verifies the official data signature, applies status, and deduplicates eventId", async () => {
    await seedDispatch();
    const event = payload();
    const first = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    const duplicate = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );

    expect(first.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ ok: true, duplicate: true });
    await expect(
      env.DB.prepare(
        `SELECT status, provider_status, provider_observed_at, tracking_url, version
         FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-1'`,
      ).first(),
    ).resolves.toEqual({
      status: "ACTIVE",
      provider_status: "IN_DELIVERY",
      provider_observed_at: Date.parse(event.data.updatedAt),
      tracking_url: event.data.order.shareLink,
      version: 2,
    });
    const inbox = await env.DB.prepare(
      `SELECT provider_event_id, processing_status, raw_payload
       FROM delivery_provider_event_inbox WHERE provider='lalamove' AND json_extract(raw_payload,'$.eventId')=?`,
    )
      .bind(event.eventId)
      .first<{ provider_event_id: string; processing_status: string; raw_payload: string }>();
    expect(inbox).toMatchObject({
      provider_event_id: JSON.stringify([event.eventType, event.eventId]),
      processing_status: "APPLIED",
    });
    expect(inbox?.raw_payload).toContain("Ana Private Customer");
    await expect(
      env.DB.prepare(
        "SELECT status,version FROM delivery_job WHERE id='job-lalamove-webhook-1'",
      ).first(),
    ).resolves.toEqual({ status: "EN_ROUTE", version: 2 });
  });

  it("rejects a payload whose signed data was changed", async () => {
    const original = payload({ eventId: "event-signed-original" });
    const originalSignature = await signature(original);
    const changed = payload({ eventId: "event-signed-original", status: "COMPLETED" });
    const response = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(changed, originalSignature),
      crypto.randomUUID(),
    );
    expect(response.status).toBe(401);
  });

  it("retains authenticated non-status events for reconciliation and acknowledges them", async () => {
    await seedDispatch("driver", "1900000000000000007");
    const event = {
      ...payload({ eventId: "event-driver-assigned" }),
      eventType: "DRIVER_ASSIGNED",
    };
    event.data.order.orderId = "1900000000000000007";
    const response = await handleLalamoveWebhook(
      env.DB,
      credentials,
      await request(event),
      crypto.randomUUID(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reconciliationRequired: true });
    await expect(
      env.DB.prepare(
        `SELECT processing_status, last_error_code FROM delivery_provider_event_inbox
         WHERE json_extract(raw_payload,'$.eventId')='event-driver-assigned'`,
      ).first(),
    ).resolves.toEqual({
      processing_status: "RECONCILIATION_REQUIRED",
      last_error_code: "LALAMOVE_EVENT_REQUIRES_RECONCILIATION",
    });
  });
});

describe("Lalamove provider event recovery", () => {
  let activeSuffix = "";
  let activeProviderId = "";
  beforeEach(() => {
    activeSuffix = crypto.randomUUID();
    activeProviderId = `event-order-${activeSuffix}`;
  });
  const seedEvents = () => seedDispatch(activeSuffix, activeProviderId);
  const send = async (event: { timestamp: string; data: unknown; [key: string]: unknown }) => {
    const data = event.data as { order?: { orderId: string } };
    if (data?.order?.orderId === "1900000000000000001") data.order.orderId = activeProviderId;
    return handleLalamoveWebhook(
      env.DB,
      credentials,
      await request({ ...event, eventId: `${activeSuffix}:${event.eventId}` }),
      crypto.randomUUID(),
    );
  };
  const readDispatch = () =>
    env.DB.prepare(
      `SELECT provider_delivery_id,provider_status,status,driver_id,custody_review_required,replacement_pending,missing_delivery_proof FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-${activeSuffix}'`,
    ).first();
  const event = (eventId: string, eventType: string, data: unknown) => ({
    ...payload({ eventId }),
    eventType,
    data,
  });
  it("accepts the actual sandbox minute-dot timestamp using signed Unix time and stable retry identity", async () => {
    const wallet = event("sandbox-clock", "WALLET_BALANCE_CHANGED", {
      balance: { amount: "100.00", currency: "PHP" },
      updatedAt: "2026-10-06T02:47.00Z",
    });
    wallet.timestamp = "1791226068";
    expect((await send(wallet)).status).toBe(200);
    expect((await send({ ...wallet, timestamp: "1791226098" })).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT observed_at,processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(`${activeSuffix}:sandbox-clock`)
        .first(),
    ).toEqual({ observed_at: 1791226068000, processing_status: "APPLIED" });
  });
  it("accepts wallet envelopes without an order, and rejects different evidence reusing an event ID", async () => {
    const wallet = event("wallet", "WALLET_BALANCE_CHANGED", {
      balance: { amount: "100.00", currency: "PHP" },
      updatedAt: "2026-09-04T01:00:00Z",
    });
    expect((await send(wallet)).status).toBe(200);
    expect(
      (
        await send({
          ...wallet,
          data: {
            balance: { amount: "101.00", currency: "PHP" },
            updatedAt: "2026-09-04T01:00:00Z",
          },
        })
      ).status,
    ).toBe(409);
    expect(
      await env.DB.prepare(
        `SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')='${activeSuffix}:wallet'`,
      ).first(),
    ).toEqual({ processing_status: "APPLIED" });
  });
  it("accepts actual sandbox shared IDs across status and driver event types, then deduplicates each type", async () => {
    await seedEvents();
    const status = payload({ eventId: "shared-driver-event", status: "ON_GOING" });
    const driver = event("shared-driver-event", "DRIVER_ASSIGNED", {
      order: { orderId: payload().data.order.orderId },
      driver: {
        driverId: "shared-driver",
        name: "Synthetic rider",
        phone: "+639000000000",
        plateNumber: "TEST",
      },
      updatedAt: "2026-09-04T01:01:00Z",
    });
    expect((await send(status)).status).toBe(200);
    // A retained deployment used bare event IDs. Preserve that receipt while
    // accepting the second provider event type sharing its ID.
    await env.DB.prepare(
      "UPDATE delivery_provider_event_inbox SET provider_event_id=? WHERE json_extract(raw_payload,'$.eventId')=?",
    )
      .bind(`${activeSuffix}:shared-driver-event`, `${activeSuffix}:shared-driver-event`)
      .run();
    expect((await send(driver)).status).toBe(200);
    expect(await readDispatch()).toMatchObject({
      provider_status: "PENDING_PICKUP",
      driver_id: "shared-driver",
    });
    expect(await (await send(driver)).json()).toMatchObject({ duplicate: true });
    expect(await (await send(status)).json()).toMatchObject({ duplicate: true });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(`${activeSuffix}:shared-driver-event`)
        .first(),
    ).toEqual({ n: 2 });
  });
  it("clears before-pickup assignment, preserves custody after pickup, and ignores delayed driver assignments", async () => {
    await seedEvents();
    const assigned = payload({ eventId: "assigned", status: "ON_GOING" });
    expect((await send(assigned)).status).toBe(200);
    expect(
      (
        await send(
          event("driver", "DRIVER_ASSIGNED", {
            order: { orderId: assigned.data.order.orderId },
            driver: {
              driverId: "driver-a",
              name: "Sandbox rider",
              phone: "+639171110000",
              plateNumber: "TEST",
            },
            updatedAt: "2026-09-04T01:01:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await readDispatch()).toMatchObject({ driver_id: "driver-a" });
    expect(
      (
        await send(
          payload({
            eventId: "rematch-before",
            status: "ASSIGNING_DRIVER",
            updatedAt: "2026-09-04T01:02:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await readDispatch()).toMatchObject({ driver_id: null, custody_review_required: 0 });
    expect(
      await env.DB.prepare(
        `SELECT status FROM delivery_job WHERE id='job-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ status: "UNASSIGNED" });
    await send(
      payload({ eventId: "picked", status: "PICKED_UP", updatedAt: "2026-09-04T01:03:00Z" }),
    );
    expect(
      (
        await send(
          payload({
            eventId: "rematch-after",
            status: "ASSIGNING_DRIVER",
            updatedAt: "2026-09-04T01:04:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await readDispatch()).toMatchObject({ driver_id: null, custody_review_required: 1 });
    await send(
      event("late-driver", "DRIVER_ASSIGNED", {
        order: { orderId: assigned.data.order.orderId },
        driver: { driverId: "driver-old" },
        updatedAt: "2026-09-04T01:01:30Z",
      }),
    );
    expect(await readDispatch()).toMatchObject({ driver_id: null });
    await send(
      payload({
        eventId: "replacement-assigned",
        status: "ON_GOING",
        updatedAt: "2026-09-04T01:05:00Z",
      }),
    );
    expect(
      await env.DB.prepare(
        `SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY" });
    expect(
      await env.DB.prepare(
        `SELECT status FROM delivery_job WHERE id='job-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ status: "EN_ROUTE" });
  });
  it("follows replacement lineage and replays an early new-order callback without a second dispatch", async () => {
    await seedEvents();
    await env.DB.prepare(
      "INSERT INTO delivery_stop(id,delivery_job_id,status) VALUES (?,?,'UNASSIGNED')",
    )
      .bind(`replacement-stop-${activeSuffix}`, `job-lalamove-webhook-${activeSuffix}`)
      .run();
    await send(
      payload({
        eventId: "original-assigned",
        status: "ON_GOING",
        updatedAt: "2026-09-04T00:59:00Z",
      }),
    );
    const newId = "1900000000000000099";
    const early = payload({
      eventId: "new-early",
      status: "ON_GOING",
      updatedAt: "2026-09-04T01:03:00Z",
    });
    early.data.order.orderId = newId;
    expect((await send(early)).status).toBe(200);
    const cancel = payload({ eventId: "support-cancel", status: "CANCELED" });
    await send({
      ...cancel,
      data: {
        ...cancel.data,
        order: { ...cancel.data.order, cancelParty: "LALAMOVE_CUSTOMER_SUPPORT" },
      },
    });
    expect(await readDispatch()).toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      replacement_pending: 1,
    });
    expect(
      (
        await send(
          event("replaced", "ORDER_REPLACED", {
            prevOrderId: activeProviderId,
            order: { orderId: newId },
            updatedAt: "2026-09-04T01:02:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT status FROM delivery_stop WHERE id=?")
        .bind(`replacement-stop-${activeSuffix}`)
        .first(),
    ).toEqual({ status: "UNASSIGNED" });
    await reconcileProviderObservations(env.DB, Date.now());
    expect(await readDispatch()).toMatchObject({
      provider_delivery_id: newId,
      provider_status: "PENDING_PICKUP",
      replacement_pending: 0,
      status: "ACTIVE",
    });
    await send(
      payload({ eventId: "retired-cancel", status: "CANCELED", updatedAt: "2026-09-04T02:00:00Z" }),
    );
    expect(await readDispatch()).toMatchObject({ provider_delivery_id: newId, status: "ACTIVE" });
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS n FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ n: 1 });
    expect(
      (
        await env.DB.prepare(
          `SELECT provider_delivery_id,previous_provider_delivery_id FROM delivery_provider_identity WHERE dispatch_id='dispatch-lalamove-webhook-${activeSuffix}' ORDER BY observed_at,provider_delivery_id`,
        ).all()
      ).results,
    ).toHaveLength(2);
  });
  it("completes without proof, clears the internal flag on late signed evidence, and never advances status from a proof event", async () => {
    await seedEvents();
    const id = payload().data.order.orderId;
    await send(payload({ eventId: "completed", status: "COMPLETED" }));
    expect(await readDispatch()).toMatchObject({
      provider_status: "COMPLETED",
      missing_delivery_proof: 1,
    });
    expect(
      (
        await send(
          event("proof", "POD_STATUS_CHANGED", {
            order: {
              orderId: id,
              status: "PICKED_UP",
              stops: [{}, { POD: { status: "SIGNED", deliveredAt: "2026-09-04T01:00:00Z" } }],
            },
            updatedAt: "2026-09-04T01:02:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await readDispatch()).toMatchObject({
      provider_status: "COMPLETED",
      missing_delivery_proof: 0,
    });
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS n FROM notification_outbox WHERE event_type='DELIVERED' AND aggregate_id='order-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ n: 1 });
  });
  it("changes courier cost without changing the customer charge or order total", async () => {
    await seedEvents();
    await env.DB.prepare(
      `UPDATE delivery_provider_dispatch SET final_payable_minor=4000,customer_delivery_charge_minor=5000,courier_variance_minor=-1000,delivery_currency='PHP' WHERE id='dispatch-lalamove-webhook-${activeSuffix}'`,
    ).run();
    await send(
      event("cost", "ORDER_AMOUNT_CHANGED", {
        order: {
          orderId: payload().data.order.orderId,
          price: { currency: "PHP", totalPrice: "45.25" },
        },
        updatedAt: "2026-09-04T01:00:00Z",
      }),
    );
    expect(
      await env.DB.prepare(
        `SELECT final_payable_minor,customer_delivery_charge_minor,courier_variance_minor FROM delivery_provider_dispatch WHERE id='dispatch-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({
      final_payable_minor: 4525,
      customer_delivery_charge_minor: 5000,
      courier_variance_minor: -475,
    });
    expect(
      await env.DB.prepare(
        `SELECT total_minor FROM grocery_order WHERE id='order-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ total_minor: 20000 });
  });
  it("retains pickup/code/edit evidence without changing commercial snapshots or inferring delivery", async () => {
    await seedEvents();
    const order = { orderId: payload().data.order.orderId, status: "COMPLETED" };
    expect(
      (
        await send(
          event("created", "ORDER_CREATED", {
            order: { ...order, status: "ASSIGNING_DRIVER" },
            updatedAt: "2026-09-04T00:59:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          event("pickup-proof", "POP_STATUS_CHANGED", {
            order: {
              ...order,
              stops: [
                {
                  POP: {
                    imageUrls: ["https://example.invalid/pickup", "javascript:alert(1)"],
                    pickedUpAt: "2026-09-04T01:00:00Z",
                  },
                },
              ],
            },
            updatedAt: "2026-09-04T01:01:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          event("code", "DELIVERY_CODE_STATUS_CHANGED", {
            order: {
              ...order,
              stops: [{}, { deliveryCode: { status: "VERIFIED", value: "1234" } }],
            },
            updatedAt: "2026-09-04T01:02:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(
          event("edit", "ORDER_EDITED", {
            order: { ...order, stops: [{ address: "Provider changed address" }] },
            updatedAt: "2026-09-04T01:03:00Z",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await readDispatch()).toMatchObject({ status: "ACTIVE", provider_status: "ALLOCATING" });
    expect(
      await env.DB.prepare(
        "SELECT route_review_required,request_snapshot_json FROM delivery_provider_dispatch WHERE id=?",
      )
        .bind(`dispatch-lalamove-webhook-${activeSuffix}`)
        .first(),
    ).toEqual({ route_review_required: 1, request_snapshot_json: '{"protected":true}' });
    expect(
      await env.DB.prepare("SELECT address_snapshot_json,status FROM grocery_order WHERE id=?")
        .bind(`order-lalamove-webhook-${activeSuffix}`)
        .first(),
    ).toEqual({ address_snapshot_json: "{}", status: "FULFILLMENT_READY" });
    const evidence = await env.DB.prepare(
      "SELECT evidence_json FROM delivery_provider_evidence WHERE dispatch_id=? AND kind='PICKUP_PROOF'",
    )
      .bind(`dispatch-lalamove-webhook-${activeSuffix}`)
      .first<{ evidence_json: string }>();
    expect(JSON.parse(evidence!.evidence_json)[0].imageUrls).toEqual([
      "https://example.invalid/pickup",
    ]);
    await send(
      payload({
        eventId: "completed-code",
        status: "COMPLETED",
        updatedAt: "2026-09-04T01:04:00Z",
      }),
    );
    expect(await readDispatch()).toMatchObject({
      provider_status: "COMPLETED",
      missing_delivery_proof: 0,
    });
  });
  it("defers an unsupported amount instead of acknowledging a cost projection", async () => {
    await seedEvents();
    const response = await send(
      event("unsupported-cost", "ORDER_AMOUNT_CHANGED", {
        order: {
          orderId: payload().data.order.orderId,
          price: { currency: "USD", totalPrice: "4.123" },
        },
        updatedAt: "2026-09-04T01:00:00Z",
      }),
    );
    expect(await response.json()).toMatchObject({ reconciliationRequired: true });
    expect(
      await env.DB.prepare(
        "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
      )
        .bind(`${activeSuffix}:unsupported-cost`)
        .first(),
    ).toEqual({ processing_status: "RECONCILIATION_REQUIRED" });
  });
  it("rolls back delivery and its receipt when a required evidence write is ignored, then safely redrives", async () => {
    await seedEvents();
    await env.DB.exec(
      "CREATE TRIGGER ignore_provider_evidence BEFORE INSERT ON delivery_provider_evidence WHEN NEW.kind='DELIVERY_PROOF' BEGIN SELECT RAISE(IGNORE); END",
    );
    const completed = payload({ eventId: "atomic-proof", status: "COMPLETED" });
    const withProof = {
      ...completed,
      data: {
        ...completed.data,
        order: { ...completed.data.order, stops: [{}, { POD: { status: "SIGNED" } }] },
      },
    };
    try {
      expect((await send(withProof)).status).toBe(202);
      expect(await readDispatch()).toMatchObject({
        status: "ACTIVE",
        provider_status: "ALLOCATING",
      });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
          .bind(`order-lalamove-webhook-${activeSuffix}`)
          .first(),
      ).toEqual({ status: "FULFILLMENT_READY" });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
        )
          .bind(`${activeSuffix}:atomic-proof`)
          .first(),
      ).toEqual({ processing_status: "RECONCILIATION_REQUIRED" });
      expect(
        await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE aggregate_id=?")
          .bind(`order-lalamove-webhook-${activeSuffix}`)
          .first(),
      ).toEqual({ n: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_provider_evidence");
    }
    await reconcileProviderObservations(env.DB, Date.now());
    expect(await readDispatch()).toMatchObject({ status: "COMPLETED", missing_delivery_proof: 0 });
  });
  it("retains a conflicting replacement without changing either dispatch identity", async () => {
    await seedEvents();
    const otherId = `other-${activeSuffix}`;
    await seedDispatch(otherId, `other-provider-${activeSuffix}`);
    const replacement = event("conflicting-replacement", "ORDER_REPLACED", {
      prevOrderId: activeProviderId,
      order: { orderId: `other-provider-${activeSuffix}` },
      updatedAt: "2026-09-04T01:00:00Z",
    });
    expect((await send(replacement)).status).toBe(202);
    expect(await readDispatch()).toMatchObject({
      provider_delivery_id: activeProviderId,
      status: "ACTIVE",
    });
    expect(
      await env.DB.prepare("SELECT provider_delivery_id FROM delivery_provider_dispatch WHERE id=?")
        .bind(`dispatch-lalamove-webhook-${otherId}`)
        .first(),
    ).toEqual({ provider_delivery_id: `other-provider-${activeSuffix}` });
  });
  it("rejects an ignored driver update without saving contact or an applied receipt", async () => {
    await seedEvents();
    await env.DB.exec(
      "CREATE TRIGGER ignore_assigned_driver BEFORE UPDATE OF driver_id ON delivery_provider_dispatch WHEN NEW.driver_id='ignored-rider' BEGIN SELECT RAISE(IGNORE); END",
    );
    const driver = event("ignored-driver", "DRIVER_ASSIGNED", {
      order: { orderId: payload().data.order.orderId },
      driver: { driverId: "ignored-rider" },
      updatedAt: "2026-09-04T01:00:00Z",
    });
    try {
      expect((await send(driver)).status).toBe(202);
      expect(await readDispatch()).toMatchObject({ driver_id: null });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS n FROM delivery_provider_evidence WHERE dispatch_id=?",
        )
          .bind(`dispatch-lalamove-webhook-${activeSuffix}`)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE json_extract(raw_payload,'$.eventId')=?",
        )
          .bind(`${activeSuffix}:ignored-driver`)
          .first(),
      ).toEqual({ processing_status: "RECONCILIATION_REQUIRED" });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_assigned_driver");
    }
    expect((await send(driver)).status).toBe(200);
    expect(await readDispatch()).toMatchObject({ driver_id: "ignored-rider" });
  });
  it("repairs a missed callback through GET, bounds failed reads and never retries provider mutations", async () => {
    await seedEvents();
    await env.DB.prepare(
      `UPDATE delivery_provider_dispatch SET next_lookup_at=9007199254740991 WHERE id!='dispatch-lalamove-webhook-${activeSuffix}'`,
    ).run();
    const provider = createMockDeliveryProvider();
    let reads = 0;
    let writes = 0;
    provider.get = async () => {
      reads++;
      return {
        ok: true,
        value: {
          providerDeliveryId: activeProviderId,
          merchantOrderId: null,
          status: "IN_DELIVERY",
          trackingUrl: null,
          pickupPin: null,
          quote: null,
        },
      };
    };
    provider.create = async () => {
      writes++;
      throw new Error("Unexpected create");
    };
    provider.cancel = async () => {
      writes++;
      throw new Error("Unexpected cancel");
    };
    const now = Date.parse("2026-09-04T02:00:00Z");
    expect(await lookupProviderDeliveries(env.DB, new Map([["lalamove", provider]]), now)).toEqual({
      attempted: 1,
      applied: 1,
    });
    expect(
      await env.DB.prepare(
        `SELECT status FROM grocery_order WHERE id='order-lalamove-webhook-${activeSuffix}'`,
      ).first(),
    ).toEqual({ status: "OUT_FOR_DELIVERY" });
    expect(await lookupProviderDeliveries(env.DB, new Map([["lalamove", provider]]), now)).toEqual({
      attempted: 0,
      applied: 0,
    });
    provider.get = async () => {
      reads++;
      return { ok: false, error: { code: "UNAVAILABLE", retryable: true, outcomeUnknown: false } };
    };
    for (let i = 1; i <= 6; i++)
      await lookupProviderDeliveries(env.DB, new Map([["lalamove", provider]]), now + i * 3600000);
    expect(reads).toBe(6);
    expect(writes).toBe(0);
  });
});
