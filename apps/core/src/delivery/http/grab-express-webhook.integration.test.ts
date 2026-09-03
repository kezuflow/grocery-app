import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { handleGrabExpressWebhook } from "./grab-express-webhook";

const credentials = {
  DELIVERY_PROVIDER: "grab-express",
  GRAB_EXPRESS_WEBHOOK_CLIENT_ID: "freshmarkets-grab-client",
  GRAB_EXPRESS_WEBHOOK_SECRET: "freshmarkets-grab-webhook-secret",
} as const;

function webhookRequest(payload: unknown, overrides: Record<string, string> = {}) {
  return new Request("https://core.example.invalid/webhooks/delivery/grab-express", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization-id": credentials.GRAB_EXPRESS_WEBHOOK_CLIENT_ID,
      authorization: credentials.GRAB_EXPRESS_WEBHOOK_SECRET,
      ...overrides,
    },
    body: JSON.stringify(payload),
  });
}

function payload(options: { timestamp?: number; status?: string } = {}) {
  return {
    deliveryID: "PH-GRAB-WEBHOOK-1",
    merchantOrderID: "FM-ORDER-WEBHOOK-1",
    timestamp: options.timestamp ?? 1_788_400_000,
    status: options.status ?? "IN_DELIVERY",
    trackURL: "https://grab.example/tracking/private",
    pickupPin: "0451",
    failedReason: "",
    recipient: {
      name: "Ana Private Customer",
      address: "Unit 4B, Private Street, Cebu City",
    },
    driver: { currentLat: 10.317331, currentLng: 123.905812 },
  };
}

async function seedDispatch(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_job
     (id, order_id, cycle_id, fulfillment_mode, location_id, zone_id, status,
      context_resolution_status, address_snapshot_json, version, created_at, updated_at)
     VALUES ('job-grab-webhook-1', 'order-grab-webhook-1', NULL, 'INSTANT',
             'location-cebu-central', 'zone-cebu-city-core', 'UNASSIGNED',
             'RESOLVED', '{}', 1, 1, 1)`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO delivery_provider_dispatch
     (id, delivery_job_id, provider, merchant_order_id, provider_delivery_id,
      request_hash, request_snapshot_json, status, provider_status,
      attempt_count, version, created_at, updated_at)
     VALUES ('dispatch-grab-webhook-1', 'job-grab-webhook-1', 'grab-express',
             'FM-ORDER-WEBHOOK-1', 'PH-GRAB-WEBHOOK-1', 'request-hash',
             '{"protected":true}', 'ACTIVE', 'ALLOCATING', 1, 1, 1, 1)`,
  ).run();
}

describe("GrabExpress tracking webhook", () => {
  it("authenticates, deduplicates, and stores the provider observation without logging delivery data", async () => {
    await seedDispatch();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const event = payload();
      const first = await handleGrabExpressWebhook(
        env.DB,
        credentials,
        webhookRequest(event),
        crypto.randomUUID(),
      );
      const duplicate = await handleGrabExpressWebhook(
        env.DB,
        credentials,
        webhookRequest(event),
        crypto.randomUUID(),
      );

      expect(first.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ ok: true, duplicate: true });
      await expect(
        env.DB.prepare(
          `SELECT status, provider_status, provider_observed_at, tracking_url,
                  pickup_pin, version
           FROM delivery_provider_dispatch WHERE id='dispatch-grab-webhook-1'`,
        ).first(),
      ).resolves.toEqual({
        status: "ACTIVE",
        provider_status: "IN_DELIVERY",
        provider_observed_at: event.timestamp * 1_000,
        tracking_url: event.trackURL,
        pickup_pin: event.pickupPin,
        version: 2,
      });
      const inbox = await env.DB.prepare(
        `SELECT processing_status, raw_payload
         FROM delivery_provider_event_inbox
         WHERE provider_delivery_id='PH-GRAB-WEBHOOK-1'`,
      ).first<{ processing_status: string; raw_payload: string }>();
      expect(inbox?.processing_status).toBe("APPLIED");
      expect(inbox?.raw_payload).toContain("Ana Private Customer");

      const logs = logSpy.mock.calls.flat().join(" ");
      for (const protectedValue of [
        "Ana Private Customer",
        "Unit 4B, Private Street",
        event.trackURL,
        event.pickupPin,
        credentials.GRAB_EXPRESS_WEBHOOK_SECRET,
        "10.317331",
      ]) {
        expect(logs).not.toContain(protectedValue);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not let an older event regress the latest provider observation", async () => {
    await seedDispatch();
    const latest = payload({ timestamp: 1_788_500_000, status: "COMPLETED" });
    const older = payload({ timestamp: 1_788_400_000, status: "PENDING_PICKUP" });
    await handleGrabExpressWebhook(
      env.DB,
      credentials,
      webhookRequest(latest),
      crypto.randomUUID(),
    );
    const response = await handleGrabExpressWebhook(
      env.DB,
      credentials,
      webhookRequest(older),
      crypto.randomUUID(),
    );

    expect(await response.json()).toMatchObject({ ok: true, ignoredAsOlder: true });
    await expect(
      env.DB.prepare(
        "SELECT status, provider_status FROM delivery_provider_dispatch WHERE id='dispatch-grab-webhook-1'",
      ).first(),
    ).resolves.toEqual({ status: "COMPLETED", provider_status: "COMPLETED" });
  });

  it("rejects bad credentials before retaining the webhook body", async () => {
    const event = { ...payload(), deliveryID: "PH-UNAUTHORIZED-DELIVERY" };
    const response = await handleGrabExpressWebhook(
      env.DB,
      credentials,
      webhookRequest(event, { authorization: "wrong-secret" }),
      crypto.randomUUID(),
    );

    expect(response.status).toBe(401);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_event_inbox WHERE provider_delivery_id=?",
      )
        .bind(event.deliveryID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });

  it("rejects a timestamp that cannot be represented safely in milliseconds", async () => {
    const event = { ...payload(), deliveryID: "PH-UNSAFE-TIMESTAMP", timestamp: 9_007_199_254_741 };
    const response = await handleGrabExpressWebhook(
      env.DB,
      credentials,
      webhookRequest(event),
      crypto.randomUUID(),
    );

    expect(response.status).toBe(400);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) count FROM delivery_provider_event_inbox WHERE provider_delivery_id=?",
      )
        .bind(event.deliveryID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });
});
