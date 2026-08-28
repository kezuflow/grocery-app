import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getLocationMode, resolveCheckoutMode, setFulfillmentLocationMode } from "./location-mode";

let locationCounter = 0;
async function seedLocation(): Promise<string> {
  const id = `location-instant-${++locationCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, version, created_at, updated_at) VALUES (?, 'market-metro-cebu', ?, 'Instant Hub', 'FULFILLMENT_CENTER', 10.3, 123.9, 'active', 1, ?, ?)",
  )
    .bind(id, `inst-${id}`, now, now)
    .run();
  return id;
}

function command(locationId: string, overrides: Record<string, unknown> = {}) {
  return {
    locationId,
    activeMode: "INSTANT" as const,
    promiseMinutes: 90,
    maxConcurrentInstantOrders: 20,
    expectedVersion: null as number | null,
    idempotencyKey: `mode-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("fulfillment location mode configuration", () => {
  it("defaults an unconfigured location to Scheduled and resolves it for checkout", async () => {
    const locationId = await seedLocation();
    const view = await getLocationMode(env.DB, { locationId, requestId: crypto.randomUUID() });
    if (!view.ok) throw new Error("seeded location was not found");
    expect(view.value).toMatchObject({ activeMode: "SCHEDULED", cadence: "WEEKLY", version: 0 });
    const resolved = await resolveCheckoutMode(env.DB, locationId);
    expect(resolved).toMatchObject({ ok: true, mode: "SCHEDULED" });
  });

  it("activates INSTANT with promise and capacity and resolves it", async () => {
    const locationId = await seedLocation();
    const result = await setFulfillmentLocationMode(env.DB, command(locationId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      activeMode: "INSTANT",
      promiseMinutes: 90,
      maxConcurrentInstantOrders: 20,
      version: 1,
    });
    const resolved = await resolveCheckoutMode(env.DB, locationId);
    expect(resolved).toMatchObject({
      ok: true,
      mode: "INSTANT",
      promiseMinutes: 90,
      maxConcurrentInstantOrders: 20,
    });
  });

  it("replays the same configuration for a repeated idempotency key", async () => {
    const locationId = await seedLocation();
    const attempt = command(locationId);
    await setFulfillmentLocationMode(env.DB, attempt);
    const replay = await setFulfillmentLocationMode(env.DB, attempt);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.version).toBe(1);
  });

  it("updates atomically through the configuration version and retires the prior mode", async () => {
    const locationId = await seedLocation();
    await setFulfillmentLocationMode(env.DB, command(locationId));
    const updated = await setFulfillmentLocationMode(
      env.DB,
      command(locationId, {
        activeMode: "SCHEDULED",
        promiseMinutes: null,
        maxConcurrentInstantOrders: null,
        cadence: "WEEKLY",
        expectedVersion: 1,
      }),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ activeMode: "SCHEDULED", cadence: "WEEKLY", version: 2 });
    const resolved = await resolveCheckoutMode(env.DB, locationId);
    expect(resolved).toMatchObject({ ok: true, mode: "SCHEDULED" });
    // A stale version cannot rewrite the retired configuration.
    const stale = await setFulfillmentLocationMode(
      env.DB,
      command(locationId, { expectedVersion: 1 }),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("fails closed when INSTANT lacks promise or capacity bounds", async () => {
    const locationId = await seedLocation();
    const missing = await setFulfillmentLocationMode(
      env.DB,
      command(locationId, { promiseMinutes: null }),
    );
    expect(missing).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const resolved = await resolveCheckoutMode(env.DB, locationId);
    expect(resolved).toMatchObject({ ok: true, mode: "SCHEDULED" });
  });

  it("rejects a cadence for INSTANT and missing Scheduled cadence", async () => {
    const locationId = await seedLocation();
    expect(
      await setFulfillmentLocationMode(env.DB, command(locationId, { cadence: "WEEKLY" })),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await setFulfillmentLocationMode(
        env.DB,
        command(locationId, {
          activeMode: "SCHEDULED",
          promiseMinutes: null,
          maxConcurrentInstantOrders: null,
          cadence: null,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("refuses an unknown or inactive location", async () => {
    const result = await setFulfillmentLocationMode(
      env.DB,
      command(`location-missing-${crypto.randomUUID().slice(0, 8)}`),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("does not fabricate a Scheduled configuration for an unknown location", async () => {
    const mode = await getLocationMode(env.DB, {
      locationId: `missing-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    });
    expect(mode).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
