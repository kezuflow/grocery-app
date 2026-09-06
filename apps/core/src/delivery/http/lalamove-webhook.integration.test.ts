import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleLalamoveWebhook } from "./lalamove-webhook";

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

async function seedDispatch() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_job
     (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, status,
      context_resolution_status, address_snapshot_json, version, created_at, updated_at)
     VALUES ('job-lalamove-webhook-1', 'order-lalamove-webhook-1', NULL, 'INSTANT',
             'location-cebu-central', 'zone-cebu-city-core', 'UNASSIGNED',
             'RESOLVED', '{}', 1, 1, 1)`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_provider_dispatch
     (id, delivery_job_id, provider, merchant_order_id, provider_delivery_id,
      request_hash, request_snapshot_json, status, provider_status,
      attempt_count, version, created_at, updated_at)
     VALUES ('dispatch-lalamove-webhook-1', 'job-lalamove-webhook-1', 'lalamove',
             'FM-LALAMOVE-WEBHOOK-1', '1900000000000000001', 'request-hash',
             '{"protected":true}', 'ACTIVE', 'ALLOCATING', 1, 1, 1, 1)`,
  ).run();
}

describe("Lalamove tracking webhook", () => {
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
       FROM delivery_provider_event_inbox WHERE provider='lalamove'`,
    ).first<{ provider_event_id: string; processing_status: string; raw_payload: string }>();
    expect(inbox).toMatchObject({
      provider_event_id: event.eventId,
      processing_status: "APPLIED",
    });
    expect(inbox?.raw_payload).toContain("Ana Private Customer");
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
    await seedDispatch();
    const event = {
      ...payload({ eventId: "event-driver-assigned" }),
      eventType: "DRIVER_ASSIGNED",
    };
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
