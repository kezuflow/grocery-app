import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type {
  CoreServiceBinding,
  DeliveryMapDetailRequest,
  DeliveryMapRequest,
} from "@freshmarkets/contracts";
import { beforeEach, describe, expect, it } from "vitest";

const core = exports.default as unknown as CoreServiceBinding;
const CENTRAL = "location-cebu-central";
const WEST = "location-delivery-map-west";
const CYCLE = "cycle-next-cebu";
const OTHER_CYCLE = "cycle-delivery-map-other";
const ZONE = "zone-cebu-city-core";
const NOW = 1_800_000_000_000;
type ScheduledDetailRequest = Extract<DeliveryMapDetailRequest, { fulfillmentMode: "SCHEDULED" }>;

const addressSnapshot = JSON.stringify({
  address_components_json: JSON.stringify({
    addressLine1: "1 Mango Avenue",
    addressLine2: "Unit 2",
    barangay: "Lahug",
    city: "Cebu City",
    region: "Cebu",
    postalCode: "6000",
    countryCode: "PH",
  }),
});
const contactSnapshot = JSON.stringify({ recipient: "Alex D.", phone: "+639171234567" });
const instructionsSnapshot = JSON.stringify({
  buildingUnit: "Unit 2",
  landmark: "Blue gate",
  gateGuard: null,
  deliveryNote: "Call on arrival",
  recipientInstruction: null,
});
const legacyAddressSnapshot = JSON.stringify({
  address_json: JSON.stringify({
    line1: "43 Legacy Road",
    line2: "Door 4",
    barangay: "Lahug",
    region: "Cebu",
    postalCode: "6000",
  }),
});

let counter = 0;
let readerCookie = "";
let deniedCookie = "";
let fixturesSeeded = false;

async function signUp(name: string): Promise<{ cookie: string; userId: string }> {
  const email = `delivery-map-${++counter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
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

async function seedStaff(capabilities: readonly string[], locationId: string) {
  const principal = await signUp("Delivery reader");
  const staffId = `staff-map-${crypto.randomUUID()}`;
  const roleId = `role-map-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Delivery reader', 'active', ?, ?)",
    ).bind(staffId, principal.userId, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Map role', ?)",
    ).bind(roleId, `map-${crypto.randomUUID()}`, NOW),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'location', NULL, ?)",
    ).bind(`scope-${crypto.randomUUID()}`, staffId, locationId),
  ];
  for (const capability of capabilities) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'delivery map', ?)",
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
  orderId?: string;
  batchId?: string | null;
  sequence?: number | null;
  cycleId?: string | null;
  mode?: "INSTANT" | "SCHEDULED";
  locationId?: string;
  riderId?: string | null;
  status?: string;
  resolution?: "RESOLVED" | "LEGACY_UNRESOLVED";
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  contact?: string;
  instructions?: string | null;
  version?: number;
};

async function seedJob(fixture: JobFixture): Promise<void> {
  const batchId = fixture.batchId ?? null;
  const sequence = batchId === null ? null : (fixture.sequence ?? 1);
  const cycleId = fixture.cycleId === undefined ? CYCLE : fixture.cycleId;
  const mode = fixture.mode ?? "SCHEDULED";
  const locationId = fixture.locationId ?? CENTRAL;
  const status = fixture.status ?? "UNASSIGNED";
  const resolution = fixture.resolution ?? "RESOLVED";
  const version = fixture.version ?? 1;
  const address = fixture.address ?? addressSnapshot;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, batch_id, sequence, cycle_id, fulfillment_mode, location_id, zone_id, rider_id, status, context_resolution_status, address_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      fixture.id,
      fixture.orderId ?? `order-${fixture.id}`,
      batchId,
      sequence,
      cycleId,
      mode,
      locationId,
      ZONE,
      fixture.riderId ?? null,
      status,
      resolution,
      address,
      version,
      NOW,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json, contact_snapshot_json, instructions_snapshot, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      `stop-${fixture.id}`,
      fixture.id,
      batchId,
      sequence,
      fixture.latitude === undefined ? 10.3157 : fixture.latitude,
      fixture.longitude === undefined ? 123.8854 : fixture.longitude,
      address,
      fixture.contact ?? contactSnapshot,
      fixture.instructions === undefined ? instructionsSnapshot : fixture.instructions,
      status,
      version,
      NOW,
      NOW,
    ),
  ]);
}

async function seedFixtures(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fulfillment_location (id, market_id, code, name, type, address_json, latitude, longitude, status, version, created_at, updated_at) VALUES (?, 'market-metro-cebu', 'MAP-WEST', 'Map West', 'DISPATCH_ONLY', NULL, 10.32, 123.82, 'active', 1, ?, ?)",
    ).bind(WEST, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_cycle (id, market_id, name, order_opens_at, cutoff_at, delivery_date, status, capacity, allocated, version) VALUES (?, 'market-metro-cebu', 'Other map cycle', ?, ?, ?, 'OPEN', 100, 0, 1)",
    ).bind(OTHER_CYCLE, NOW - 1_000, NOW + 1_000, NOW + 10_000),
    env.DB.prepare(
      "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES (?, ?, ?, 100, 0, 1)",
    ).bind(OTHER_CYCLE, ZONE, CENTRAL),
    env.DB.prepare(
      "INSERT INTO cycle_zone_capacity (cycle_id, zone_id, location_id, capacity, allocated, version) VALUES (?, ?, ?, 100, 0, 1)",
    ).bind(CYCLE, ZONE, WEST),
    env.DB.prepare(
      "INSERT INTO rider_identity (id, staff_id, auth_user_id, display_name, preferred_location_id, status, version, created_at, updated_at) VALUES ('rider-active', NULL, NULL, 'Alpha Rider', ?, 'ACTIVE', 1, ?, ?)",
    ).bind(CENTRAL, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id, staff_id, auth_user_id, display_name, preferred_location_id, status, version, created_at, updated_at) VALUES ('rider-application-only', NULL, NULL, 'Beta Rider', NULL, 'ACTIVE', 1, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id, staff_id, auth_user_id, display_name, preferred_location_id, status, version, created_at, updated_at) VALUES ('rider-inactive', NULL, NULL, 'Dormant Rider', ?, 'SUSPENDED', 1, ?, ?)",
    ).bind(CENTRAL, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id, staff_id, auth_user_id, display_name, preferred_location_id, status, version, created_at, updated_at) VALUES ('rider-west', NULL, NULL, 'West Rider', ?, 'ACTIVE', 1, ?, ?)",
    ).bind(WEST, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-assigned', 'SCHEDULED', ?, ?, ?, 'rider-active', 'ASSIGNED', 'RESOLVED', 1, ?, ?)",
    ).bind(CYCLE, CENTRAL, ZONE, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-unresolved', NULL, NULL, NULL, NULL, 'EXCEPTION', 'LEGACY_UNRESOLVED', 1, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_batch (id, fulfillment_mode, cycle_id, location_id, zone_id, status, context_resolution_status, version, created_at, updated_at) VALUES ('batch-conflicting', 'SCHEDULED', ?, ?, ?, 'READY', 'RESOLVED', 1, ?, ?)",
    ).bind(OTHER_CYCLE, CENTRAL, ZONE, NOW, NOW),
  ]);

  await seedJob({ id: "job-a-unassigned", version: 3 });
  await seedJob({ id: "job-b-retry", status: "RETRY_SCHEDULED", version: 4 });
  await seedJob({
    id: "job-c-assigned",
    batchId: "batch-assigned",
    riderId: "rider-active",
    status: "ASSIGNED",
    version: 5,
  });
  await seedJob({
    id: "job-d-unresolved-batch",
    batchId: "batch-unresolved",
    status: "RETRY_SCHEDULED",
  });
  await seedJob({
    id: "job-e-conflicting-batch",
    batchId: "batch-conflicting",
    status: "RETRY_SCHEDULED",
  });
  await seedJob({ id: "job-f-failed", status: "FAILED" });
  await seedJob({ id: "job-g-missing-coordinate", latitude: null, longitude: null });
  await seedJob({ id: "job-h-delivered", status: "DELIVERED", riderId: "rider-active" });
  await seedJob({ id: "job-i-canceled", status: "CANCELED" });
  await seedJob({ id: "job-j-other-cycle", cycleId: OTHER_CYCLE });
  await seedJob({ id: "job-k-other-location", locationId: WEST });
  await seedJob({ id: "job-l-instant", mode: "INSTANT", cycleId: null });
  await seedJob({ id: "job-m-malformed", address: "not-json", contact: "not-json" });
  await seedJob({ id: "job-n-legacy-address", address: legacyAddressSnapshot });
  await seedJob({
    id: "job-o-empty-address",
    address: JSON.stringify({ address_json: "{}" }),
  });
}

beforeEach(async () => {
  if (fixturesSeeded) return;
  await seedFixtures();
  readerCookie = await seedStaff(["delivery.read", "delivery.manage"], CENTRAL);
  deniedCookie = await seedStaff(["fulfillment.read"], CENTRAL);
  fixturesSeeded = true;
});

function scheduledRequest(overrides: Partial<DeliveryMapRequest> = {}): DeliveryMapRequest {
  return {
    requestId: crypto.randomUUID(),
    headers: { cookie: readerCookie },
    locationId: CENTRAL,
    fulfillmentMode: "SCHEDULED",
    cycleId: CYCLE,
    ...overrides,
  } as DeliveryMapRequest;
}

describe("scoped delivery map reads", () => {
  it("enforces Staff capability, location scope, and runtime mode/cycle ownership", async () => {
    await expect(core.getDeliveryMap(scheduledRequest({ headers: {} }))).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(
      core.getDeliveryMap(scheduledRequest({ headers: { cookie: deniedCookie } })),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(
      core.getDeliveryMap(
        scheduledRequest({
          headers: { cookie: deniedCookie },
          locationId: "location-delivery-map-missing",
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    for (const locationId of [WEST, "location-delivery-map-missing"]) {
      const deniedMap = await core.getDeliveryMap(scheduledRequest({ locationId }));
      expect(deniedMap).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(JSON.stringify(deniedMap)).not.toContain("job-a-unassigned");
      await expect(
        core.getDeliveryMapDetail({
          ...scheduledRequest({ locationId }),
          jobId: "job-a-unassigned",
          expectedVersion: 3,
        } as ScheduledDetailRequest),
      ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      await expect(core.getEligibleRiders(scheduledRequest({ locationId }))).resolves.toMatchObject(
        {
          ok: false,
          error: { code: "NOT_FOUND" },
        },
      );
    }
    await expect(
      core.getDeliveryMap({
        ...scheduledRequest(),
        fulfillmentMode: "INSTANT",
        cycleId: CYCLE,
      } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await expect(
      core.getDeliveryMap({
        ...scheduledRequest(),
        fulfillmentMode: "MIXED",
        cycleId: null,
      } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await expect(
      core.getDeliveryMap({
        ...scheduledRequest(),
        fulfillmentMode: "SCHEDULED",
        cycleId: "cycle-missing",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("returns stable open pins in the exact context and derives selection in Core", async () => {
    const result = await core.getDeliveryMap(scheduledRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      locationId: CENTRAL,
      fulfillmentMode: "SCHEDULED",
      cycleId: CYCLE,
    });
    expect(result.value.pins.map((pin) => pin.jobId)).toEqual([
      "job-a-unassigned",
      "job-b-retry",
      "job-c-assigned",
      "job-d-unresolved-batch",
      "job-e-conflicting-batch",
      "job-f-failed",
      "job-g-missing-coordinate",
      "job-m-malformed",
      "job-n-legacy-address",
      "job-o-empty-address",
    ]);
    expect(result.value.pins[0]).toEqual({
      jobId: "job-a-unassigned",
      orderId: "order-job-a-unassigned",
      batchId: null,
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
      fulfillmentMode: "SCHEDULED",
      cycleId: CYCLE,
      status: "UNASSIGNED",
      rider: null,
      version: 3,
      selection: { selectable: true, reason: null },
    });
    expect(result.value.pins.find((pin) => pin.jobId === "job-b-retry")?.selection).toEqual({
      selectable: true,
      reason: null,
    });
    expect(result.value.pins.find((pin) => pin.jobId === "job-c-assigned")).toMatchObject({
      rider: { riderId: "rider-active", displayName: "Alpha Rider" },
      selection: { selectable: false, reason: "STATUS_NOT_ASSIGNABLE" },
    });
    expect(
      result.value.pins.find((pin) => pin.jobId === "job-d-unresolved-batch")?.selection,
    ).toEqual({ selectable: false, reason: "BATCH_CONTEXT_UNRESOLVED" });
    expect(
      result.value.pins.find((pin) => pin.jobId === "job-e-conflicting-batch")?.selection,
    ).toEqual({ selectable: false, reason: "BATCH_CONTEXT_MISMATCH" });
    expect(result.value.pins.find((pin) => pin.jobId === "job-f-failed")?.selection).toEqual({
      selectable: false,
      reason: "STATUS_NOT_ASSIGNABLE",
    });
    expect(result.value.pins.find((pin) => pin.jobId === "job-g-missing-coordinate")).toMatchObject(
      {
        coordinate: null,
        selection: { selectable: false, reason: "MISSING_COORDINATE" },
      },
    );
    for (const pin of result.value.pins) {
      expect(pin).not.toHaveProperty("addressSnapshotJson");
      expect(pin).not.toHaveProperty("authUserId");
      expect(pin).not.toHaveProperty("provider");
    }

    const filtered = await core.getDeliveryMap(
      scheduledRequest({ statuses: ["ASSIGNED"], riderId: "rider-active" }),
    );
    expect(filtered).toMatchObject({ ok: true, value: { pins: [{ jobId: "job-c-assigned" }] } });
  });

  it("protects detail context/version and maps only safe immutable stop snapshots", async () => {
    const request = {
      ...scheduledRequest(),
      jobId: "job-a-unassigned",
      expectedVersion: 3,
    } as ScheduledDetailRequest;
    const result = await core.getDeliveryMapDetail(request);
    expect(result).toEqual({
      ok: true,
      value: {
        jobId: "job-a-unassigned",
        orderId: "order-job-a-unassigned",
        orderNumber: null,
        destination: {
          coordinate: { latitude: 10.3157, longitude: 123.8854 },
          displayAddress: "1 Mango Avenue, Unit 2, Lahug, Cebu City, Cebu, 6000, PH",
          recipient: "Alex D.",
          phone: "+639171234567",
          instructions: {
            buildingUnit: "Unit 2",
            landmark: "Blue gate",
            gateGuard: null,
            deliveryNote: "Call on arrival",
            recipientInstruction: null,
          },
        },
        status: "UNASSIGNED",
        version: 3,
        allowedActions: ["CREATE_AND_ASSIGN_BATCH"],
      },
      requestId: request.requestId,
    });
    await expect(
      core.getDeliveryMapDetail({ ...request, expectedVersion: 2 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    await expect(
      core.getDeliveryMapDetail({ ...request, cycleId: OTHER_CYCLE }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      core.getDeliveryMapDetail({ ...request, jobId: "job-l-instant" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      core.getDeliveryMapDetail({ ...request, jobId: "job-h-delivered", expectedVersion: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      core.getDeliveryMapDetail({ ...request, jobId: "job-m-malformed", expectedVersion: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    const legacy = await core.getDeliveryMapDetail({
      ...request,
      jobId: "job-n-legacy-address",
      expectedVersion: 1,
    });
    expect(legacy).toMatchObject({
      ok: true,
      value: {
        orderId: "order-job-n-legacy-address",
        orderNumber: null,
        destination: {
          displayAddress: "43 Legacy Road, Door 4, Lahug, 43 Legacy Road, Cebu, 6000, PH",
        },
      },
    });
    expect(JSON.stringify(legacy)).not.toContain("address_json");
    expect(JSON.stringify(legacy)).not.toContain("addressLine1");
    await expect(
      core.getDeliveryMapDetail({
        ...request,
        jobId: "job-o-empty-address",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    await expect(
      core.getDeliveryMapDetail({
        ...request,
        jobId: "job-g-missing-coordinate",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        destination: { coordinate: null },
        allowedActions: [],
      },
    });
    await expect(
      core.getDeliveryMapDetail({
        ...request,
        jobId: "job-d-unresolved-batch",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ ok: true, value: { allowedActions: [] } });
  });

  it("returns only compatible active canonical Riders with global open workload", async () => {
    const result = await core.getEligibleRiders(scheduledRequest());
    expect(result).toEqual({
      ok: true,
      value: [
        {
          riderId: "rider-active",
          displayName: "Alpha Rider",
          openBatchCount: 1,
          openDeliveryCount: 1,
        },
        {
          riderId: "rider-application-only",
          displayName: "Beta Rider",
          openBatchCount: 0,
          openDeliveryCount: 0,
        },
      ],
      requestId: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain("auth_user_id");
    expect(JSON.stringify(result)).not.toContain("staff_id");
  });

  it("rejects malformed runtime request and filter shapes without throwing", async () => {
    await expect(
      core.getDeliveryMap({ ...scheduledRequest(), statuses: "UNASSIGNED" } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await expect(
      core.getDeliveryMap({ ...scheduledRequest(), riderId: { id: "rider-active" } } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await expect(core.getDeliveryMap(null as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    await expect(
      core.getDeliveryMapDetail({
        ...scheduledRequest(),
        jobId: { id: "job-a-unassigned" },
        expectedVersion: 3,
      } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await expect(
      core.getEligibleRiders({ ...scheduledRequest(), locationId: { id: CENTRAL } } as never),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});
