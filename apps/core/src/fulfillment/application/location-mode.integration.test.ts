import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getGlobalMode, resolveCheckoutMode, setGlobalFulfillmentMode } from "./location-mode";

let locationCounter = 0;
async function seedReadyLocation(): Promise<string> {
  const id = `location-instant-${++locationCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fulfillment_location (id, market_id, code, name, type, latitude, longitude, status, version, created_at, updated_at) VALUES (?, 'market-metro-cebu', ?, 'Instant Hub', 'FULFILLMENT_CENTER', 10.3, 123.9, 'active', 1, ?, ?)",
    ).bind(id, `inst-${id}`, now, now),
    env.DB.prepare(
      "INSERT INTO fulfillment_location_readiness (location_id,instant_promise_minutes,max_concurrent_instant_orders,dispatch_ready,version,created_at,updated_at) VALUES (?,90,20,1,1,?,?)",
    ).bind(id, now, now),
  ]);
  return id;
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    activeMode: "INSTANT" as const,
    cadence: null,
    expectedVersion: 1,
    idempotencyKey: `mode-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

beforeEach(async () => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE global_fulfillment_mode SET active_mode='SCHEDULED',cadence='WEEKLY',version=1,updated_at=? WHERE id='global'",
    ).bind(now),
    env.DB.prepare("DELETE FROM idempotency_records WHERE scope='fulfillment.setGlobalMode'"),
    env.DB.prepare(
      `INSERT INTO fulfillment_location_readiness
         (location_id,instant_promise_minutes,max_concurrent_instant_orders,dispatch_ready,version,created_at,updated_at)
       SELECT id,90,20,1,1,?,? FROM fulfillment_location WHERE status='active'
       ON CONFLICT(location_id) DO UPDATE SET instant_promise_minutes=90,
         max_concurrent_instant_orders=20,dispatch_ready=1,version=1,updated_at=excluded.updated_at`,
    ).bind(now, now),
  ]);
});

describe("global fulfillment mode configuration", () => {
  it("reads one Scheduled configuration for every location", async () => {
    const locationId = await seedReadyLocation();
    expect(await getGlobalMode(env.DB, { requestId: crypto.randomUUID() })).toMatchObject({
      ok: true,
      value: { activeMode: "SCHEDULED", cadence: "WEEKLY", version: 1 },
    });
    expect(await resolveCheckoutMode(env.DB, locationId)).toEqual({ ok: true, mode: "SCHEDULED" });
  });

  it("activates INSTANT globally and resolves location readiness", async () => {
    const locationId = await seedReadyLocation();
    expect(await setGlobalFulfillmentMode(env.DB, command())).toMatchObject({
      ok: true,
      value: { activeMode: "INSTANT", cadence: null, version: 2 },
    });
    expect(await resolveCheckoutMode(env.DB, locationId)).toMatchObject({
      ok: true,
      mode: "INSTANT",
      promiseMinutes: 90,
      maxConcurrentInstantOrders: 20,
    });
  });

  it("replays one idempotent global activation", async () => {
    await seedReadyLocation();
    const attempt = command();
    const applied = await setGlobalFulfillmentMode(env.DB, attempt);
    const replay = await setGlobalFulfillmentMode(env.DB, attempt);
    expect(applied).toEqual(replay);
    expect(replay).toMatchObject({ ok: true, value: { version: 2 } });
  });

  it("uses optimistic concurrency for the one global row", async () => {
    await seedReadyLocation();
    expect(await setGlobalFulfillmentMode(env.DB, command())).toMatchObject({ ok: true });
    expect(
      await setGlobalFulfillmentMode(
        env.DB,
        command({ activeMode: "SCHEDULED", cadence: "WEEKLY", expectedVersion: 1 }),
      ),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("blocks INSTANT when any active location is not dispatch-ready", async () => {
    const locationId = await seedReadyLocation();
    await env.DB.prepare(
      "UPDATE fulfillment_location_readiness SET dispatch_ready=0 WHERE location_id=?",
    )
      .bind(locationId)
      .run();
    expect(await setGlobalFulfillmentMode(env.DB, command())).toMatchObject({
      ok: false,
      error: { code: "CONFIGURATION_ERROR" },
    });
  });

  it("rejects invalid cadence combinations", async () => {
    expect(await setGlobalFulfillmentMode(env.DB, command({ cadence: "WEEKLY" }))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(
      await setGlobalFulfillmentMode(env.DB, command({ activeMode: "SCHEDULED", cadence: null })),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});
