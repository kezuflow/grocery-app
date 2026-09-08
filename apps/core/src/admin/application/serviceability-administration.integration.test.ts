import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { PublishAdminServiceAreaRequest } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { publishAdminServiceArea } from "./serviceability-administration";
import { createAuth } from "../../auth/service";
const core = exports.default;
const vertices = [
  { latitude: 10.2, longitude: 123.8 },
  { latitude: 10.2, longitude: 124 },
  { latitude: 10.5, longitude: 124 },
  { latitude: 10.5, longitude: 123.8 },
];
function command(headers: Record<string, string>): PublishAdminServiceAreaRequest {
  return {
    headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    marketId: "market-metro-cebu",
    code: `area-${crypto.randomUUID()}`,
    name: "Test service area",
    vertices,
    zones: [
      { code: "central", name: "Central zone", vertices, locationIds: ["location-cebu-central"] },
    ],
    expectedVersion: 0,
    reason: "Confirm operating boundary",
  };
}
async function effects(key: string) {
  return env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM idempotency_records WHERE idempotency_key=?) records,(SELECT COUNT(*) FROM audit_event WHERE idempotency_key=?) audits",
  )
    .bind(key, key)
    .first();
}

describe("Global service-area publication", () => {
  it("paginates stable area keys and rejects malformed cursors", async () => {
    const manager = await locationManager();
    const polygon = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [123.8, 10.2],
          [124, 10.2],
          [124, 10.5],
          [123.8, 10.2],
        ],
      ],
    });
    await env.DB.batch(
      Array.from({ length: 22 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO service_area(id,market_id,code,name,polygon_geojson,polygon_version,active_from,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,'Pagination area',?,1,0,'active',0,0)",
        ).bind(`page-${index}`, `page-${String(index).padStart(2, "0")}`, polygon),
      ),
    );
    const first = await core.getAdminServiceability({
      headers: manager.headers,
      requestId: "page-one",
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.value.nextCursor) throw new Error("Missing next page");
    expect(first.value.areas).toHaveLength(20);
    const second = await core.getAdminServiceability({
      headers: manager.headers,
      requestId: "page-two",
      cursor: first.value.nextCursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.areas).toHaveLength(3);
    expect(second.value.nextCursor).toBeNull();
    expect(
      new Set([...first.value.areas, ...second.value.areas].map((area) => area.serviceAreaId)).size,
    ).toBe(23);
    expect(
      await core.getAdminServiceability({
        headers: manager.headers,
        requestId: "invalid",
        cursor: "invalid",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
  it("publishes immutable versions, audits once, replays exactly and rejects changed keys", async () => {
    const manager = await locationManager(),
      request = command(manager.headers);
    const first = await core.publishAdminServiceArea(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await core.publishAdminServiceArea({ ...request, requestId: "replay" })).toMatchObject({
      ok: true,
      value: first.value,
    });
    expect(await effects(request.idempotencyKey)).toEqual({ records: 1, audits: 1 });
    expect(await core.publishAdminServiceArea({ ...request, name: "Changed" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    const before = await env.DB.prepare("SELECT polygon_geojson FROM service_area WHERE id=?")
      .bind(first.value.serviceAreaId)
      .first();
    const second = await core.publishAdminServiceArea({
      ...request,
      name: "Reviewed area",
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(second).toMatchObject({ ok: true, value: { version: 2 } });
    expect(
      await env.DB.prepare("SELECT polygon_geojson FROM service_area WHERE id=?")
        .bind(first.value.serviceAreaId)
        .first(),
    ).toEqual(before);
    expect(
      await env.DB.prepare("SELECT status FROM service_area WHERE id=?")
        .bind(first.value.serviceAreaId)
        .first(),
    ).toEqual({ status: "inactive" });
    expect(
      await env.DB.prepare("SELECT version FROM geography_configuration WHERE market_id=?")
        .bind(request.marketId)
        .first(),
    ).toEqual({ version: 3 });
    const read = await core.getAdminServiceability({ headers: manager.headers, requestId: "read" });
    expect(read.ok).toBe(true);
    if (read.ok)
      expect(read.value.areas.find((area) => area.code === request.code)?.name).toBe(
        "Reviewed area",
      );
    await env.DB.prepare(
      "UPDATE fulfillment_location SET status='inactive' WHERE id='location-cebu-central'",
    ).run();
    try {
      const inactive = await core.getAdminServiceability({
        headers: manager.headers,
        requestId: "inactive-assignment",
      });
      expect(inactive.ok).toBe(true);
      if (inactive.ok)
        expect(
          inactive.value.locations.find(
            (location) => location.locationId === "location-cebu-central",
          ),
        ).toMatchObject({ unavailable: true });
    } finally {
      await env.DB.prepare(
        "UPDATE fulfillment_location SET status='active' WHERE id='location-cebu-central'",
      ).run();
    }
  });
  it("rejects invalid shapes, outside zones, missing sites and non-Global callers without effects", async () => {
    const manager = await locationManager(),
      local = await locationManager("location");
    const requests = [
      command({}),
      command(local.headers),
      {
        ...command(manager.headers),
        vertices: [vertices[0], vertices[2], vertices[1], vertices[3]],
      },
      {
        ...command(manager.headers),
        zones: [
          {
            code: "outside",
            name: "Outside",
            vertices: vertices.map((point) => ({ ...point, latitude: point.latitude + 1 })),
            locationIds: ["location-cebu-central"],
          },
        ],
      },
      {
        ...command(manager.headers),
        zones: [{ code: "missing", name: "Missing", vertices, locationIds: ["missing"] }],
      },
    ];
    for (const request of requests) {
      expect((await core.publishAdminServiceArea(request)).ok).toBe(false);
      expect(await effects(request.idempotencyKey)).toEqual({ records: 0, audits: 0 });
    }
  });
  it("serializes concurrent publication and rolls back permission loss at the batch boundary", async () => {
    const manager = await locationManager(),
      request = command(manager.headers);
    const raced = await Promise.all([
      core.publishAdminServiceArea(request),
      core.publishAdminServiceArea(request),
    ]);
    expect(raced.every((result) => result.ok)).toBe(true);
    expect(await effects(request.idempotencyKey)).toEqual({ records: 1, audits: 1 });
    const rejected = command(manager.headers);
    let reachedBatch = false;
    const database = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            reachedBatch = true;
            await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await publishAdminServiceArea({ db: database, auth: createAuth(env) }, rejected),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(reachedBatch).toBe(true);
    expect(await effects(rejected.idempotencyKey)).toEqual({ records: 0, audits: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM service_area WHERE code=?")
        .bind(rejected.code)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("previews the closest current-mode site only inside its assigned active polygons", async () => {
    const manager = await locationManager();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET fulfillment_mode='INSTANT',cadence=NULL,selling_state='PAUSED',version=version+1 WHERE id='global'",
      ),
      env.DB.prepare(
        "UPDATE fulfillment_location_readiness SET dispatch_ready=1,instant_promise_minutes=45,max_concurrent_instant_orders=10 WHERE location_id='location-cebu-central'",
      ),
    ]);
    const preview = {
      headers: manager.headers,
      requestId: "preview",
      marketId: "market-metro-cebu",
      latitude: 10.32,
      longitude: 123.9,
    };
    expect(await core.previewAdminServiceability(preview)).toMatchObject({
      ok: true,
      value: { serviceable: true, locationId: "location-cebu-central" },
    });
    expect(await core.previewAdminServiceability({ ...preview, latitude: 20 })).toMatchObject({
      ok: true,
      value: { serviceable: false, locationId: null },
    });
    await env.DB.prepare("UPDATE location_serviceability SET valid_to=?")
      .bind(Date.now() - 1)
      .run();
    expect(await core.previewAdminServiceability(preview)).toMatchObject({
      ok: true,
      value: { serviceable: false },
    });
  });
  it.each([
    "BEFORE INSERT ON idempotency_records",
    "BEFORE INSERT ON service_area",
    "BEFORE INSERT ON delivery_zone",
    "BEFORE INSERT ON location_serviceability",
    "BEFORE INSERT ON geography_configuration",
    "BEFORE INSERT ON audit_event",
    "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'",
  ])("rolls back suppressed publication effect %s and recovers", async (trigger) => {
    const manager = await locationManager();
    const request = command(manager.headers);
    await env.DB.exec(
      `CREATE TRIGGER ignore_area_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await core.publishAdminServiceArea(request)).toMatchObject({ ok: false });
      expect(await effects(request.idempotencyKey)).toEqual({ records: 0, audits: 0 });
      expect(
        await env.DB.prepare("SELECT count(*) count FROM service_area WHERE code=?")
          .bind(request.code)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_area_effect");
    }
    const result = await core.publishAdminServiceArea(request);
    expect(result).toMatchObject({ ok: true });
    expect(await core.publishAdminServiceArea(request)).toEqual(result);
  });
  it.each(["location_serviceability", "delivery_zone", "service_area"])(
    "retains the old boundary when %s retirement is suppressed",
    async (table) => {
      const manager = await locationManager();
      const original = command(manager.headers);
      const first = await core.publishAdminServiceArea(original);
      if (!first.ok) throw new Error("First publication failed");
      const next = {
        ...original,
        name: "Revised boundary",
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      };
      const before = await env.DB.prepare(
        "SELECT version FROM geography_configuration WHERE market_id=?",
      )
        .bind(original.marketId)
        .first();
      await env.DB.exec(
        `CREATE TRIGGER ignore_area_retirement BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await core.publishAdminServiceArea(next)).toMatchObject({ ok: false });
        expect(await effects(next.idempotencyKey)).toEqual({ records: 0, audits: 0 });
        expect(
          await env.DB.prepare("SELECT status,polygon_version FROM service_area WHERE id=?")
            .bind(first.value.serviceAreaId)
            .first(),
        ).toEqual({ status: "active", polygon_version: 1 });
        expect(
          await env.DB.prepare("SELECT version FROM geography_configuration WHERE market_id=?")
            .bind(original.marketId)
            .first(),
        ).toEqual(before);
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_area_retirement");
      }
      const result = await core.publishAdminServiceArea(next);
      expect(result).toMatchObject({ ok: true, value: { version: 2 } });
      expect(await core.publishAdminServiceArea(next)).toEqual(result);
    },
  );
});
