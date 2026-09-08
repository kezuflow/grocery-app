import { describe, it, expect, onTestFinished } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { saveAdminLocationSchedule } from "./location-schedule-administration";
import { createAuth } from "../../auth/service";
import { operationalCandidates } from "../../geography/application/operational-candidates";

const locationId = "location-cebu-central";
const schedule = {
  weekly: Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    opensMinute: 0,
    closesMinute: 1440,
  })),
  closures: [],
};
async function command() {
  const staff = await locationManager();
  const current = await exports.default.getAdminLocationSchedule({
    headers: staff.headers,
    requestId: crypto.randomUUID(),
    locationId,
  });
  if (!current.ok) throw new Error(current.error.message);
  return {
    staff,
    request: {
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      locationId,
      expectedVersion: current.value.version,
      schedule,
      reason: "Review opening hours",
      idempotencyKey: crypto.randomUUID(),
    },
  };
}
describe("Global location operating schedules", () => {
  it("expires routing evidence when a nearer closed location opens", async () => {
    const nearer = crypto.randomUUID(),
      now = Date.now(),
      opensAt = now + 60000;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET fulfillment_mode='INSTANT',cadence=NULL WHERE id='global'",
      ),
      env.DB.prepare(`INSERT INTO fulfillment_location(id,market_id,code,name,type,purpose,status,latitude,longitude,version,created_at,updated_at)
        SELECT ?,market_id,?,'Nearer site',type,purpose,'active',10.32,123.9,1,0,0 FROM fulfillment_location WHERE id=?`).bind(
        nearer,
        nearer,
        locationId,
      ),
      env.DB.prepare(
        "INSERT INTO location_capability(location_id,capability,enabled) SELECT ?,capability,enabled FROM location_capability WHERE location_id=?",
      ).bind(nearer, locationId),
      env.DB.prepare(
        "INSERT INTO location_serviceability(zone_id,location_id,priority,eligible,valid_from) VALUES ('zone-cebu-city-core',?,1,1,0)",
      ).bind(nearer),
      env.DB.prepare(
        "INSERT INTO fulfillment_location_readiness(location_id,dispatch_ready,instant_promise_minutes,max_concurrent_instant_orders,version,created_at,updated_at) VALUES (?,1,60,10,1,0,0)",
      ).bind(nearer),
      env.DB.prepare(
        "UPDATE fulfillment_location_readiness SET dispatch_ready=1,instant_promise_minutes=60,max_concurrent_instant_orders=10 WHERE location_id=?",
      ).bind(locationId),
      env.DB.prepare(
        "INSERT INTO location_operating_schedule(location_id,timezone,definition_json,updated_at) VALUES (?,'Asia/Manila',?,0)",
      ).bind(
        nearer,
        JSON.stringify({
          ...schedule,
          closures: [
            {
              startsAt: new Date(now - 3600000).toISOString(),
              endsAt: new Date(opensAt).toISOString(),
              reason: "Opens later",
            },
          ],
        }),
      ),
    ]);
    onTestFinished(async () => {
      await env.DB.batch([
        env.DB.prepare("UPDATE fulfillment_location SET status='inactive' WHERE id=?").bind(nearer),
        env.DB.prepare(
          "UPDATE global_commerce_configuration SET fulfillment_mode='SCHEDULED',cadence='WEEKLY' WHERE id='global'",
        ),
      ]);
    });
    const before = await operationalCandidates(
      env.DB,
      { latitude: 10.32, longitude: 123.9 },
      { mode: "INSTANT", now },
    );
    expect(before[0]?.locationId).toBe(locationId);
    expect(before[0]?.openInterval?.endsAt).toBe(opensAt);
    const after = await operationalCandidates(
      env.DB,
      { latitude: 10.32, longitude: 123.9 },
      { mode: "INSTANT", now: opensAt },
    );
    expect(after[0]?.locationId).toBe(nearer);
  });
  it.each([
    ["claim", "BEFORE INSERT ON idempotency_records"],
    ["location version", "BEFORE UPDATE ON fulfillment_location"],
    ["schedule", "BEFORE UPDATE ON location_operating_schedule"],
    ["geography version", "BEFORE UPDATE ON geography_configuration"],
    ["audit", "BEFORE INSERT ON audit_event"],
    ["receipt", "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"],
  ])("requires %s and recovers the identical request", async (_effect, trigger) => {
    const { request } = await command();
    const before = await env.DB.prepare(
      "SELECT * FROM location_operating_schedule WHERE location_id=?",
    )
      .bind(locationId)
      .first();
    await env.DB.exec(
      `CREATE TRIGGER ignore_hours_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await exports.default.saveAdminLocationSchedule(request)).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
          .bind(locationId)
          .first(),
      ).toEqual({ version: request.expectedVersion });
      expect(
        await env.DB.prepare("SELECT * FROM location_operating_schedule WHERE location_id=?")
          .bind(locationId)
          .first(),
      ).toEqual(before);
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_hours_effect");
    }
    const saved = await exports.default.saveAdminLocationSchedule(request);
    expect(saved).toMatchObject({
      ok: true,
      value: { version: request.expectedVersion + 1, schedule },
    });
    expect(await exports.default.saveAdminLocationSchedule(request)).toEqual(saved);
    expect(
      await exports.default.saveAdminLocationSchedule({ ...request, reason: "Different" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("rejects local scope and overlapping intervals without writes", async () => {
    const { request } = await command(),
      local = await locationManager("location");
    expect(
      await exports.default.saveAdminLocationSchedule({ ...request, headers: local.headers }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await exports.default.saveAdminLocationSchedule({
        ...request,
        schedule: { weekly: [...schedule.weekly, ...schedule.weekly], closures: [] },
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("one competing schedule wins and replay retains its original result after another edit", async () => {
    const { request } = await command();
    const outcomes = await Promise.all([
      exports.default.saveAdminLocationSchedule(request),
      exports.default.saveAdminLocationSchedule({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        schedule: { weekly: [], closures: [] },
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.ok);
    if (!winner?.ok) throw new Error("No winning command");
    const later = await exports.default.saveAdminLocationSchedule({
      ...request,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: winner.value.version,
    });
    expect(later).toMatchObject({ ok: true });
    if (outcomes[0]?.ok)
      expect(await exports.default.saveAdminLocationSchedule(request)).toEqual(outcomes[0]);
  });
  it("rechecks authority within the complete write batch", async () => {
    const { staff, request } = await command();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(staff.id).run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await saveAdminLocationSchedule({ db, auth: createAuth(env) }, request)).toMatchObject({
      ok: false,
    });
    expect(
      await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
        .bind(locationId)
        .first(),
    ).toEqual({ version: request.expectedVersion });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("Scheduled eligibility evaluates future pickup, not current opening hours", async () => {
    const { request } = await command();
    const pickup = await env.DB.prepare(
      "SELECT pickup_at pickup FROM delivery_cycle_schedule WHERE cycle_id='cycle-next-cebu'",
    ).first<{ pickup: number }>();
    if (!pickup) throw new Error("Missing cycle fixture");
    const closure = {
      startsAt: new Date(pickup.pickup).toISOString(),
      endsAt: new Date(pickup.pickup + 3600000).toISOString(),
      reason: "Closed for maintenance",
    };
    expect(
      await exports.default.saveAdminLocationSchedule({
        ...request,
        schedule: { ...schedule, closures: [closure] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await operationalCandidates(
        env.DB,
        { latitude: 10.32, longitude: 123.9 },
        { mode: "SCHEDULED", cycleId: "cycle-next-cebu" },
      ),
    ).toHaveLength(0);
  });
});
