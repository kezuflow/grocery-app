import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  BatchRoutePreview,
  PreviewDeliveryBatchRouteRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type AuthEnvironment } from "../../auth/service";
import {
  RoutePreviewError,
  type RoutePreviewPort,
  type RoutePreviewResult,
} from "../../geography/ports/route-preview";
import { previewDeliveryBatchRoute } from "./preview-delivery-batch-route";

const LOCATION = "location-cebu-central";
const CYCLE = "cycle-next-cebu";
const OTHER_CYCLE = "cycle-route-preview-other";
const ZONE = "zone-cebu-city-core";
const NOW = 1_800_000_000_000;

let counter = 0;
let readerCookie = "";
let deniedCookie = "";
let fixturesSeeded = false;

async function signUp(name: string): Promise<{ cookie: string; userId: string }> {
  const email = `route-preview-${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name, email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedStaff(capabilities: readonly string[]) {
  const principal = await signUp("Route preview reader");
  const staffId = `staff-preview-${crypto.randomUUID()}`;
  const roleId = `role-preview-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Route preview reader', 'active', ?, ?)",
    ).bind(staffId, principal.userId, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Route preview role', ?)",
    ).bind(roleId, `preview-${crypto.randomUUID()}`, NOW),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
    ).bind(`scope-${crypto.randomUUID()}`, staffId, LOCATION),
  ];
  for (const capability of capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'route preview', ?)",
      ).bind(`permission-${crypto.randomUUID()}`, capability, NOW),
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return principal.cookie;
}

type JobFixture = {
  id: string;
  version?: number;
  latitude?: number | null;
  longitude?: number | null;
  locationId?: string;
  cycleId?: string | null;
  mode?: "INSTANT" | "SCHEDULED";
  resolution?: "RESOLVED" | "LEGACY_UNRESOLVED";
  batchId?: string | null;
};

async function seedJob(fixture: JobFixture): Promise<void> {
  const version = fixture.version ?? 1;
  const resolution = fixture.resolution ?? "RESOLVED";
  const cycleId = resolution === "LEGACY_UNRESOLVED" ? null : (fixture.cycleId ?? CYCLE);
  const mode = fixture.mode ?? "SCHEDULED";
  const locationId = resolution === "LEGACY_UNRESOLVED" ? null : (fixture.locationId ?? LOCATION);
  const zoneId = resolution === "LEGACY_UNRESOLVED" ? null : ZONE;
  const status = resolution === "LEGACY_UNRESOLVED" ? "ESCALATED" : "UNASSIGNED";
  const sequence = fixture.batchId ? 1 : null;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, batch_id, sequence, cycle_id, fulfillment_mode, location_id, zone_id, rider_id, status, context_resolution_status, address_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '{}', ?, ?, ?)",
    ).bind(
      fixture.id,
      `order-${fixture.id}`,
      fixture.batchId ?? null,
      sequence,
      cycleId,
      mode,
      locationId,
      zoneId,
      status,
      resolution,
      version,
      NOW,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json, contact_snapshot_json, instructions_snapshot, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', NULL, 'UNASSIGNED', ?, ?, ?)",
    ).bind(
      `stop-${fixture.id}`,
      fixture.id,
      fixture.batchId ?? null,
      sequence,
      fixture.latitude === undefined ? 10.3 : fixture.latitude,
      fixture.longitude === undefined ? 123.8 : fixture.longitude,
      version,
      NOW,
      NOW,
    ),
  ]);
}

async function seedFixtures(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_cycle (id, market_id, name, order_opens_at, cutoff_at, delivery_date, status, capacity, allocated, version) VALUES (?, 'market-metro-cebu', 'Other preview cycle', ?, ?, ?, 'OPEN', 100, 0, 1)",
    ).bind(OTHER_CYCLE, NOW - 1_000, NOW + 1_000, NOW + 10_000),
    env.DB.prepare(
      "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES (?, ?, ?, 100, 0, 1)",
    ).bind(OTHER_CYCLE, ZONE, LOCATION),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-preview-valid', 'SCHEDULED', ?, ?, ?, NULL, 'COMPLETED', 'RESOLVED', 1, ?, ?)",
    ).bind(CYCLE, LOCATION, ZONE, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-preview-unresolved', NULL, NULL, NULL, NULL, NULL, 'EXCEPTION', 'LEGACY_UNRESOLVED', 1, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-preview-active', 'SCHEDULED', ?, ?, ?, NULL, 'READY', 'RESOLVED', 1, ?, ?)",
    ).bind(CYCLE, LOCATION, ZONE, NOW, NOW),
  ]);
  await seedJob({ id: "job-preview-first", version: 3, latitude: 10.31, longitude: 123.81 });
  await seedJob({ id: "job-preview-second", version: 5, latitude: 10.32, longitude: 123.82 });
  await seedJob({ id: "job-preview-missing", latitude: null, longitude: null });
  await seedJob({ id: "job-preview-unresolved", resolution: "LEGACY_UNRESOLVED" });
  await seedJob({ id: "job-preview-other-cycle", cycleId: OTHER_CYCLE });
  await seedJob({ id: "job-preview-valid-batch", batchId: "batch-preview-valid" });
  await seedJob({ id: "job-preview-unresolved-batch", batchId: "batch-preview-unresolved" });
  await seedJob({ id: "job-preview-active-conflict", batchId: "batch-preview-active" });
  await seedJob({ id: "job-preview-stop-mismatch" });
  await seedJob({ id: "job-preview-terminal", latitude: 10.4444, longitude: 123.9444 });
  await seedJob({
    id: "job-preview-historical-coordinate",
    latitude: 10.5555,
    longitude: 123.9555,
  });
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE delivery_stop SET batch_id='batch-preview-active', sequence=7, status='ASSIGNED', version=2 WHERE delivery_job_id='job-preview-stop-mismatch'",
    ),
    env.DB.prepare(
      "UPDATE delivery_job SET status='DELIVERED', version=2 WHERE id IN ('job-preview-terminal','job-preview-historical-coordinate')",
    ),
    env.DB.prepare(
      "UPDATE delivery_stop SET status='DELIVERED', version=2 WHERE delivery_job_id IN ('job-preview-terminal','job-preview-historical-coordinate')",
    ),
  ]);
  for (let index = 1; index <= 24; index += 1) {
    await seedJob({
      id: `job-preview-max-${String(index).padStart(2, "0")}`,
      version: index,
      latitude: 10 + index / 100,
      longitude: 123 + index / 100,
    });
  }
}

const routeResult: RoutePreviewResult = {
  geometry: {
    type: "LineString",
    coordinates: [
      [123.8854, 10.3157],
      [123.82, 10.32],
      [123.81, 10.31],
    ],
  },
  totalMeters: 300,
  totalSeconds: 90,
  legs: [
    { meters: 100, seconds: 30 },
    { meters: 200, seconds: 60 },
  ],
};

function successfulPort(
  implementation: RoutePreviewPort["preview"] = async () => routeResult,
): RoutePreviewPort {
  return { preview: vi.fn(implementation) };
}

function request(
  overrides: Partial<PreviewDeliveryBatchRouteRequest> = {},
): PreviewDeliveryBatchRouteRequest {
  return {
    requestId: crypto.randomUUID(),
    headers: { cookie: readerCookie },
    locationId: LOCATION,
    fulfillmentMode: "SCHEDULED",
    cycleId: CYCLE,
    orderedDeliveries: [
      { jobId: "job-preview-second", expectedVersion: 5 },
      { jobId: "job-preview-first", expectedVersion: 3 },
    ],
    ...overrides,
  } as PreviewDeliveryBatchRouteRequest;
}

async function preview(
  routePreview: RoutePreviewPort,
  input: PreviewDeliveryBatchRouteRequest,
): Promise<RpcResult<BatchRoutePreview>> {
  return previewDeliveryBatchRoute(
    {
      auth: createAuth(env as Env & AuthEnvironment),
      db: env.DB,
      now: () => NOW,
      routePreview,
    },
    input,
  );
}

beforeEach(async () => {
  if (fixturesSeeded) return;
  await seedFixtures();
  readerCookie = await seedStaff(["delivery.read"]);
  deniedCookie = await seedStaff(["fulfillment.read"]);
  fixturesSeeded = true;
});

describe("preview delivery batch route", () => {
  it("loads the authoritative origin and immutable stops in exact submitted order", async () => {
    const routePreview = successfulPort();

    const result = await preview(routePreview, request());

    expect(routePreview.preview).toHaveBeenCalledWith({
      origin: { latitude: 10.3157, longitude: 123.8854 },
      orderedDestinations: [
        { latitude: 10.32, longitude: 123.82 },
        { latitude: 10.31, longitude: 123.81 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        outcome: "AVAILABLE",
        geometry: routeResult.geometry,
        totalMeters: 300,
        totalSeconds: 90,
        legs: [
          { jobId: "job-preview-second", meters: 100, seconds: 30 },
          { jobId: "job-preview-first", meters: 200, seconds: 60 },
        ],
        warning: null,
      },
      requestId: expect.any(String),
    });
  });

  it("enforces Staff delivery.read and concealed exact location scope", async () => {
    const routePreview = successfulPort();
    await expect(preview(routePreview, request({ headers: {} }))).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(
      preview(routePreview, request({ headers: { cookie: deniedCookie } })),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(
      preview(routePreview, request({ locationId: "location-preview-missing" })),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(routePreview.preview).not.toHaveBeenCalled();
  });

  it("accepts one and 24 unique ordered job/version pairs", async () => {
    const onePort = successfulPort(async () => ({
      ...routeResult,
      legs: [{ meters: 300, seconds: 90 }],
    }));
    await expect(
      preview(
        onePort,
        request({
          orderedDeliveries: [{ jobId: "job-preview-first", expectedVersion: 3 }],
        }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { outcome: "AVAILABLE" } });

    const orderedDeliveries = Array.from({ length: 24 }, (_, index) => ({
      jobId: `job-preview-max-${String(index + 1).padStart(2, "0")}`,
      expectedVersion: index + 1,
    }));
    const maxPort = successfulPort(async ({ orderedDestinations }) => ({
      ...routeResult,
      legs: orderedDestinations.map(() => ({ meters: 1, seconds: 1 })),
    }));
    const maxResult = await preview(maxPort, request({ orderedDeliveries }));
    expect(maxResult).toMatchObject({ ok: true, value: { outcome: "AVAILABLE" } });
    expect(maxPort.preview).toHaveBeenCalledWith({
      origin: { latitude: 10.3157, longitude: 123.8854 },
      orderedDestinations: orderedDeliveries.map((_, index) => ({
        latitude: 10 + (index + 1) / 100,
        longitude: 123 + (index + 1) / 100,
      })),
    });
  });

  it.each([
    [null],
    [{ orderedDeliveries: [] }],
    [{ orderedDeliveries: Array.from({ length: 25 }, () => ({ jobId: "x", expectedVersion: 1 })) }],
    [
      {
        orderedDeliveries: [
          { jobId: "job-preview-first", expectedVersion: 3 },
          { jobId: "job-preview-first", expectedVersion: 3 },
        ],
      },
    ],
    [{ orderedDeliveries: [{ jobId: " ", expectedVersion: 1 }] }],
    [{ orderedDeliveries: [{ jobId: "job-preview-first", expectedVersion: 0 }] }],
    [{ orderedDeliveries: [{ jobId: "job-preview-first", expectedVersion: 1.5 }] }],
    [{ orderedDeliveries: "job-preview-first" }],
    [{ orderedDeliveries: [{ jobId: { value: "job-preview-first" }, expectedVersion: 3 }] }],
  ])("rejects malformed runtime input without throwing", async (override) => {
    const routePreview = successfulPort();
    const input = override === null ? null : { ...request(), ...override };

    await expect(preview(routePreview, input as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(routePreview.preview).not.toHaveBeenCalled();
  });

  it.each([
    ["job-preview-first", 2, "STALE_VERSION"],
    ["job-preview-missing", 1, "VALIDATION_FAILED"],
    ["job-preview-unresolved", 1, "NOT_FOUND"],
    ["job-preview-other-cycle", 1, "NOT_FOUND"],
    ["job-preview-unresolved-batch", 1, "CONFLICT"],
  ] as const)(
    "rejects stale, unresolved, missing-coordinate, and mismatched authoritative rows",
    async (jobId, expectedVersion, code) => {
      const routePreview = successfulPort();

      await expect(
        preview(routePreview, request({ orderedDeliveries: [{ jobId, expectedVersion }] })),
      ).resolves.toMatchObject({ ok: false, error: { code } });
      expect(routePreview.preview).not.toHaveBeenCalled();
    },
  );

  it("accepts a resolved containing batch only when its context exactly matches", async () => {
    const routePreview = successfulPort(async () => ({
      ...routeResult,
      legs: [{ meters: 300, seconds: 90 }],
    }));

    await expect(
      preview(
        routePreview,
        request({
          orderedDeliveries: [{ jobId: "job-preview-valid-batch", expectedVersion: 1 }],
        }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { outcome: "AVAILABLE" } });
  });

  it.each([
    ["terminal job", "job-preview-terminal", 2],
    ["active batch conflict", "job-preview-active-conflict", 1],
    ["reciprocal stop mismatch", "job-preview-stop-mismatch", 1],
  ] as const)(
    "rejects non-selectable %s before invoking the route provider",
    async (_case, jobId, version) => {
      const routePreview = successfulPort(async () => ({
        ...routeResult,
        legs: [{ meters: 1, seconds: 1 }],
      }));

      await expect(
        preview(
          routePreview,
          request({ orderedDeliveries: [{ jobId, expectedVersion: version }] }),
        ),
      ).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(routePreview.preview).not.toHaveBeenCalled();
    },
  );

  it("does not disclose historical terminal coordinates to the provider", async () => {
    const routePreview = successfulPort(async () => ({
      ...routeResult,
      legs: [{ meters: 1, seconds: 1 }],
    }));

    const result = await preview(
      routePreview,
      request({
        orderedDeliveries: [{ jobId: "job-preview-historical-coordinate", expectedVersion: 2 }],
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(routePreview.preview).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("10.5555");
    expect(JSON.stringify(result)).not.toContain("123.9555");
  });

  it.each([
    ["ROUTE_NOT_FOUND", "ROUTE_NOT_FOUND"],
    ["ROUTE_TIMEOUT", "ROUTE_TIMEOUT"],
    ["ROUTE_UNAVAILABLE", "ROUTE_UNAVAILABLE"],
    ["ROUTE_UNCONFIGURED", "ROUTE_UNAVAILABLE"],
    ["ROUTE_INVALID_RESPONSE", "ROUTE_INVALID_RESPONSE"],
  ] as const)("maps provider failure %s to informational warning %s", async (failure, warning) => {
    const routePreview = successfulPort(async () => {
      throw new RoutePreviewError(failure);
    });

    await expect(preview(routePreview, request())).resolves.toEqual({
      ok: true,
      value: {
        outcome: "WARNING",
        geometry: null,
        totalMeters: null,
        totalSeconds: null,
        legs: [],
        warning: { code: warning, message: expect.any(String) },
      },
      requestId: expect.any(String),
    });
  });

  it("performs no Delivery mutation on success or provider warning", async () => {
    const before = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM delivery_job) AS jobs, (SELECT COUNT(*) FROM delivery_stop) AS stops, (SELECT COUNT(*) FROM delivery_batch) AS batches, (SELECT COUNT(*) FROM delivery_event) AS events, (SELECT GROUP_CONCAT(id || ':' || status || ':' || version, '|') FROM (SELECT id, status, version FROM delivery_job ORDER BY id)) AS job_state",
    ).first<Record<string, string | number>>();

    await preview(successfulPort(), request());
    await preview(
      successfulPort(async () => {
        throw new RoutePreviewError("ROUTE_UNAVAILABLE");
      }),
      request(),
    );

    const after = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM delivery_job) AS jobs, (SELECT COUNT(*) FROM delivery_stop) AS stops, (SELECT COUNT(*) FROM delivery_batch) AS batches, (SELECT COUNT(*) FROM delivery_event) AS events, (SELECT GROUP_CONCAT(id || ':' || status || ':' || version, '|') FROM (SELECT id, status, version FROM delivery_job ORDER BY id)) AS job_state",
    ).first<Record<string, string | number>>();
    expect(after).toEqual(before);
  });
});
