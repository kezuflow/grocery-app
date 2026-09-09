import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
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

async function signature(value: ReturnType<typeof payload>) {
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

async function request(value: ReturnType<typeof payload>, suppliedSignature?: string) {
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
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE provider_event_id='notices-pickup'",
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
        "SELECT recovery_attempts,processing_status,last_error_code FROM delivery_provider_event_inbox WHERE provider_event_id=?",
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
        "SELECT processing_status,last_error_code FROM delivery_provider_event_inbox WHERE provider_event_id=?",
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
          "SELECT processing_status FROM delivery_provider_event_inbox WHERE provider_event_id=?",
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
        "SELECT processing_status FROM delivery_provider_event_inbox WHERE provider_event_id=?",
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
        "SELECT processing_status,dispatch_id FROM delivery_provider_event_inbox WHERE provider_event_id=?",
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

  it("acknowledges Lalamove's empty registration probe", async () => {
    const response = await handleLalamoveWebhook(
      env.DB,
      credentials,
      new Request("https://core.example.invalid/webhooks/delivery/lalamove", {
        method: "POST",
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
       FROM delivery_provider_event_inbox WHERE provider='lalamove' AND provider_event_id=?`,
    )
      .bind(event.eventId)
      .first<{ provider_event_id: string; processing_status: string; raw_payload: string }>();
    expect(inbox).toMatchObject({
      provider_event_id: event.eventId,
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
         WHERE provider_event_id='event-driver-assigned'`,
      ).first(),
    ).resolves.toEqual({
      processing_status: "RECONCILIATION_REQUIRED",
      last_error_code: "LALAMOVE_EVENT_REQUIRES_RECONCILIATION",
    });
  });
});
