import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { AuthenticatedRequest, CoreServiceBinding } from "@freshmarkets/contracts";
import { beforeEach, describe, expect, it } from "vitest";

const core = exports.default as unknown as CoreServiceBinding;
const LOCATION = "location-cebu-central";
const CYCLE = "cycle-next-cebu";
const ZONE = "zone-cebu-city-core";
const NOW = 1_800_100_000_000;

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

let activeCookie = "";
let inactiveCookie = "";
let nonRiderCookie = "";
let malformedCookie = "";
let fixturesSeeded = false;

async function signUp(name: string): Promise<{ cookie: string; userId: string }> {
  const email = `rider-batches-${crypto.randomUUID()}@example.com`;
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

async function insertBatch(input: {
  batchId: string;
  riderId: string;
  mode?: "INSTANT" | "SCHEDULED";
  cycleId?: string | null;
  status?: string;
  version?: number;
}): Promise<void> {
  const mode = input.mode ?? "SCHEDULED";
  await env.DB.prepare(
    "INSERT INTO delivery_batch (id,fulfillment_mode,cycle_id,location_id,zone_id,rider_id,status,context_resolution_status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'RESOLVED',?,?,?)",
  )
    .bind(
      input.batchId,
      mode,
      input.cycleId === undefined ? (mode === "SCHEDULED" ? CYCLE : null) : input.cycleId,
      LOCATION,
      ZONE,
      input.riderId,
      input.status ?? "ASSIGNED",
      input.version ?? 1,
      NOW,
      NOW,
    )
    .run();
}

async function insertDelivery(input: {
  id: string;
  batchId: string;
  riderId: string;
  sequence: number;
  status: string;
  mode?: "INSTANT" | "SCHEDULED";
  cycleId?: string | null;
  address?: string;
  jobVersion?: number;
  stopVersion?: number;
}): Promise<void> {
  const mode = input.mode ?? "SCHEDULED";
  const cycleId =
    input.cycleId === undefined ? (mode === "SCHEDULED" ? CYCLE : null) : input.cycleId;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_job (id,order_id,batch_id,sequence,cycle_id,fulfillment_mode,location_id,zone_id,rider_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'RESOLVED',?,?,?,?)",
    ).bind(
      input.id,
      `order-${input.id}`,
      input.batchId,
      input.sequence,
      cycleId,
      mode,
      LOCATION,
      ZONE,
      input.riderId,
      input.status,
      input.address ?? addressSnapshot,
      input.jobVersion ?? 1,
      NOW,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id,delivery_job_id,batch_id,sequence,latitude,longitude,address_snapshot_json,contact_snapshot_json,instructions_snapshot,status,version,created_at,updated_at) VALUES (?,?,?,?,10.3157,123.8854,?,?,?,?,?,?,?)",
    ).bind(
      `stop-${input.id}`,
      input.id,
      input.batchId,
      input.sequence,
      input.address ?? addressSnapshot,
      contactSnapshot,
      instructionsSnapshot,
      input.status,
      input.stopVersion ?? 1,
      NOW,
      NOW,
    ),
  ]);
}

function request(cookie = activeCookie): AuthenticatedRequest {
  return { headers: cookie ? { cookie } : {}, requestId: crypto.randomUUID() };
}

beforeEach(async () => {
  if (fixturesSeeded) return;
  const [active, other, inactive, nonRider, malformed] = await Promise.all([
    signUp("Active Rider"),
    signUp("Other Rider"),
    signUp("Inactive Rider"),
    signUp("Non Rider"),
    signUp("Malformed Rider"),
  ]);
  activeCookie = active.cookie;
  inactiveCookie = inactive.cookie;
  nonRiderCookie = nonRider.cookie;
  malformedCookie = malformed.cookie;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-batches-active',NULL,?,'Active Rider',?,'ACTIVE',3,?,?)",
    ).bind(active.userId, LOCATION, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-batches-other',NULL,?,'Other Rider',?,'ACTIVE',1,?,?)",
    ).bind(other.userId, LOCATION, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-batches-inactive',NULL,?,'Inactive Rider',?,'SUSPENDED',1,?,?)",
    ).bind(inactive.userId, LOCATION, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-batches-malformed',NULL,?,'Malformed Rider',?,'ACTIVE',1,?,?)",
    ).bind(malformed.userId, LOCATION, NOW, NOW),
  ]);

  await insertBatch({
    batchId: "rider-batch-scheduled",
    riderId: "rider-batches-active",
    version: 9,
  });
  await insertDelivery({
    id: "rider-job-completed",
    batchId: "rider-batch-scheduled",
    riderId: "rider-batches-active",
    sequence: 1,
    status: "DELIVERED",
  });
  await insertDelivery({
    id: "rider-job-current",
    batchId: "rider-batch-scheduled",
    riderId: "rider-batches-active",
    sequence: 2,
    status: "ARRIVED",
    jobVersion: 7,
    stopVersion: 5,
  });
  await insertDelivery({
    id: "rider-job-upcoming",
    batchId: "rider-batch-scheduled",
    riderId: "rider-batches-active",
    sequence: 3,
    status: "ASSIGNED",
    jobVersion: 4,
    stopVersion: 2,
  });

  await insertBatch({
    batchId: "rider-batch-instant",
    riderId: "rider-batches-active",
    mode: "INSTANT",
    cycleId: null,
    status: "DISPATCHED",
    version: 2,
  });
  await insertDelivery({
    id: "rider-job-instant",
    batchId: "rider-batch-instant",
    riderId: "rider-batches-active",
    sequence: 1,
    status: "ASSIGNED",
    mode: "INSTANT",
    cycleId: null,
  });

  await insertBatch({ batchId: "rider-batch-mixed-context", riderId: "rider-batches-active" });
  await insertDelivery({
    id: "rider-job-mixed-valid",
    batchId: "rider-batch-mixed-context",
    riderId: "rider-batches-active",
    sequence: 1,
    status: "ASSIGNED",
  });
  await insertDelivery({
    id: "rider-job-mixed-invalid",
    batchId: "rider-batch-mixed-context",
    riderId: "rider-batches-active",
    sequence: 2,
    status: "ASSIGNED",
    mode: "INSTANT",
    cycleId: null,
  });

  await insertBatch({ batchId: "rider-batch-other", riderId: "rider-batches-other" });
  await insertDelivery({
    id: "rider-job-other",
    batchId: "rider-batch-other",
    riderId: "rider-batches-other",
    sequence: 1,
    status: "ASSIGNED",
  });
  await insertBatch({
    batchId: "rider-batch-finished",
    riderId: "rider-batches-active",
    status: "COMPLETED",
  });
  await insertDelivery({
    id: "rider-job-finished",
    batchId: "rider-batch-finished",
    riderId: "rider-batches-active",
    sequence: 1,
    status: "DELIVERED",
  });

  await insertBatch({ batchId: "rider-batch-malformed", riderId: "rider-batches-malformed" });
  await insertDelivery({
    id: "rider-job-malformed",
    batchId: "rider-batch-malformed",
    riderId: "rider-batches-malformed",
    sequence: 1,
    status: "ASSIGNED",
    address: "raw-private-malformed-json",
  });
  fixturesSeeded = true;
});

describe("assigned rider batch read model", () => {
  it("requires authentication and an active canonical Rider identity", async () => {
    await expect(core.getRiderBatches(request(""))).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(core.getRiderBatches(request(nonRiderCookie))).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await expect(core.getRiderBatches(request(inactiveCookie))).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("returns only the authenticated Rider's assigned operational batches in exact mode context", async () => {
    const result = await core.getRiderBatches(request());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.batches.map((batch) => batch.batchId)).toEqual([
      "rider-batch-instant",
      "rider-batch-scheduled",
    ]);
    expect(result.value.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fulfillmentMode: "SCHEDULED", cycleId: CYCLE }),
        expect.objectContaining({ fulfillmentMode: "INSTANT", cycleId: null }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("rider-job-other");
    expect(JSON.stringify(result)).not.toContain("auth_user_id");
  });

  it("selects the first unfinished immutable stop and preserves ordered upcoming stops", async () => {
    const result = await core.getRiderBatches(request());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const batch = result.value.batches.find(
      (candidate) => candidate.batchId === "rider-batch-scheduled",
    );
    expect(batch).toEqual({
      batchId: "rider-batch-scheduled",
      locationId: LOCATION,
      fulfillmentMode: "SCHEDULED",
      cycleId: CYCLE,
      status: "ASSIGNED",
      version: 9,
      currentDelivery: {
        jobId: "rider-job-current",
        stopId: "stop-rider-job-current",
        orderId: "order-rider-job-current",
        sequence: 2,
        status: "ARRIVED",
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
        jobVersion: 7,
        stopVersion: 5,
        allowedActions: ["MARK_DELIVERED", "MARK_FAILED"],
      },
      upcomingDeliveries: [
        expect.objectContaining({
          jobId: "rider-job-upcoming",
          sequence: 3,
          jobVersion: 4,
          stopVersion: 2,
          allowedActions: [],
        }),
      ],
    });
    expect(JSON.stringify(batch)).not.toContain("snapshot");
  });

  it("fails safely when a historical immutable snapshot is malformed", async () => {
    const result = await core.getRiderBatches(request(malformedCookie));
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(result)).not.toContain("raw-private-malformed-json");
  });
});
