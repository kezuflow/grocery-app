import { describe, it, expect, onTestFinished } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { configureAdminLocationFulfillment } from "./location-fulfillment-readiness";
import { createAuth } from "../../auth/service";
import { operationalCandidates } from "../../geography/application/operational-candidates";
const locationId = "location-cebu-central";
async function command() {
  const staff = await locationManager();
  const current = await exports.default.getAdminLocationFulfillment({
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
      dispatchReady: false,
      instantPromiseMinutes: 75,
      reason: "Review dispatch readiness",
      idempotencyKey: crypto.randomUUID(),
    },
  };
}
describe("Global location fulfillment readiness", () => {
  it("controls Scheduled routing without requiring an Instant promise or capacity", async () => {
    const { request } = await command();
    const enabled = await exports.default.configureAdminLocationFulfillment({
      ...request,
      dispatchReady: true,
      instantPromiseMinutes: null,
    });
    expect(enabled).toMatchObject({
      ok: true,
      value: { dispatchReady: true, instantPromiseMinutes: null },
    });
    if (!enabled.ok) throw new Error(enabled.error.message);
    expect(
      (
        await operationalCandidates(
          env.DB,
          { latitude: 10.32, longitude: 123.9 },
          { mode: "SCHEDULED" },
        )
      ).map((row) => row.locationId),
    ).toContain(locationId);
    expect(
      await exports.default.configureAdminLocationFulfillment({
        ...request,
        expectedVersion: enabled.value.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (
        await operationalCandidates(
          env.DB,
          { latitude: 10.32, longitude: 123.9 },
          { mode: "SCHEDULED" },
        )
      ).map((row) => row.locationId),
    ).not.toContain(locationId);
  });
  it.each(["authority", "capability"])("rechecks %s after the initial read", async (change) => {
    const { staff, request } = await command();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (change === "authority")
              await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(staff.id).run();
            else
              await env.DB.prepare(
                "UPDATE location_capability SET enabled=0 WHERE location_id=? AND capability='DISPATCH'",
              )
                .bind(locationId)
                .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      expect(
        await configureAdminLocationFulfillment(
          { db, auth: createAuth(env) },
          { ...request, dispatchReady: true },
        ),
      ).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
          .bind(locationId)
          .first(),
      ).toEqual({ version: request.expectedVersion });
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.prepare(
        "UPDATE location_capability SET enabled=1 WHERE location_id=? AND capability='DISPATCH'",
      )
        .bind(locationId)
        .run();
    }
  });
  it.each([
    ["claim", "BEFORE INSERT ON idempotency_records"],
    ["location version", "BEFORE UPDATE ON fulfillment_location"],
    ["readiness", "BEFORE UPDATE ON fulfillment_location_readiness"],
    ["geography version", "BEFORE UPDATE ON geography_configuration"],
    ["audit", "BEFORE INSERT ON audit_event"],
    ["receipt", "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"],
  ])("requires %s and recovers the original request", async (_effect, trigger) => {
    const { request } = await command();
    const before = await env.DB.prepare(
      "SELECT * FROM fulfillment_location_readiness WHERE location_id=?",
    )
      .bind(locationId)
      .first();
    await env.DB.exec(
      `CREATE TRIGGER ignore_readiness_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await exports.default.configureAdminLocationFulfillment(request)).toMatchObject({
        ok: false,
      });
      expect(
        await env.DB.prepare("SELECT version FROM fulfillment_location WHERE id=?")
          .bind(locationId)
          .first(),
      ).toEqual({ version: request.expectedVersion });
      expect(
        await env.DB.prepare("SELECT * FROM fulfillment_location_readiness WHERE location_id=?")
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
      await env.DB.exec("DROP TRIGGER ignore_readiness_effect");
    }
    const saved = await exports.default.configureAdminLocationFulfillment(request);
    expect(saved).toMatchObject({
      ok: true,
      value: {
        version: request.expectedVersion + 1,
        dispatchReady: false,
        instantPromiseMinutes: 75,
      },
    });
    expect(await exports.default.configureAdminLocationFulfillment(request)).toEqual(saved);
    expect(
      await exports.default.configureAdminLocationFulfillment({
        ...request,
        instantPromiseMinutes: 76,
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("rejects local scope, read-only and unauthenticated writes", async () => {
    const { request } = await command();
    for (const headers of [
      (await locationManager("location")).headers,
      (await locationManager("global", false)).headers,
      {},
    ]) {
      expect(
        await exports.default.configureAdminLocationFulfillment({ ...request, headers }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("lets only one competing version advance and freezes replay", async () => {
    const { request } = await command();
    const other = { ...request, instantPromiseMinutes: 90, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      exports.default.configureAdminLocationFulfillment(request),
      exports.default.configureAdminLocationFulfillment(other),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key IN (?,?)")
        .bind(request.idempotencyKey, other.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM idempotency_records WHERE idempotency_key IN (?,?)",
      )
        .bind(request.idempotencyKey, other.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("rejects readiness activation with missing current prerequisites without a receipt", async () => {
    const { request } = await command();
    await env.DB.prepare("UPDATE fulfillment_location SET status='inactive' WHERE id=?")
      .bind(locationId)
      .run();
    try {
      expect(
        await exports.default.configureAdminLocationFulfillment({
          ...request,
          dispatchReady: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(request.idempotencyKey)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.prepare("UPDATE fulfillment_location SET status='active' WHERE id=?")
        .bind(locationId)
        .run();
    }
  });
  it("does not require a legacy service-area link to activate a fulfillment-center pin", async () => {
    const { request } = await command();
    const links = await env.DB.prepare(
      "SELECT zone_id,location_id,valid_from,valid_to FROM location_serviceability",
    ).all<{
      zone_id: string;
      location_id: string;
      valid_from: number;
      valid_to: number | null;
    }>();
    onTestFinished(async () => {
      await env.DB.batch(
        links.results.map((row) =>
          env.DB.prepare(
            "UPDATE location_serviceability SET valid_to=? WHERE zone_id=? AND location_id=? AND valid_from=?",
          ).bind(row.valid_to, row.zone_id, row.location_id, row.valid_from),
        ),
      );
    });
    await env.DB.prepare("UPDATE location_serviceability SET valid_to=1").run();
    expect(
      await exports.default.configureAdminLocationFulfillment({
        ...request,
        dispatchReady: true,
        instantPromiseMinutes: null,
      }),
    ).toMatchObject({ ok: true, value: { dispatchReady: true } });
  });
});
