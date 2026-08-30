import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type {
  CoreServiceBinding,
  CreateAndAssignDeliveryBatchRequest,
} from "@freshmarkets/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth, type AuthEnvironment } from "../../auth/service";
import { requestHash } from "../../idempotency";
import { createAndAssignDeliveryBatch } from "./create-and-assign-delivery-batch";

const core = exports.default as unknown as CoreServiceBinding;
const LOCATION = "location-cebu-central";
const WEST = "location-batch-west";
const CYCLE = "cycle-next-cebu";
const OTHER_CYCLE = "cycle-batch-other";
const ZONE = "zone-cebu-city-core";
const NOW = 1_800_100_000_000;
let managerCookie = "";
let deniedCookie = "";
let managerStaffId = "";
let managerRoleId = "";
let managerScopeId = "";
let seeded = false;

async function signUp() {
  const email = `batch-${crypto.randomUUID()}@example.com`;
  const password = "correct-horse-battery-staple";
  const response = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Batch manager", email, password }),
  });
  expect(response.status).toBeLessThan(400);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(body.user.id).run();
  let cookie = (response.headers.getSetCookie?.() ?? []).map((x) => x.split(";", 1)[0]).join("; ");
  if (!cookie) {
    const login = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (login.headers.getSetCookie?.() ?? []).map((x) => x.split(";", 1)[0]).join("; ");
  }
  return { cookie, userId: body.user.id };
}

async function seedStaff(capability: string) {
  const principal = await signUp();
  const staffId = `staff-${crypto.randomUUID()}`;
  const roleId = `role-${crypto.randomUUID()}`;
  const scopeId = `scope-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id,auth_user_id,display_name,status,created_at,updated_at) VALUES (?,?,'Manager','active',?,?)",
    ).bind(staffId, principal.userId, NOW, NOW),
    env.DB.prepare("INSERT INTO role (id,code,name,created_at) VALUES (?,?,'Manager',?)").bind(
      roleId,
      `role-${crypto.randomUUID()}`,
      NOW,
    ),
    env.DB.prepare("INSERT INTO staff_role (staff_id,role_id) VALUES (?,?)").bind(staffId, roleId),
    env.DB.prepare(
      "INSERT INTO staff_scope (id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'location',NULL,?)",
    ).bind(scopeId, staffId, LOCATION),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id,code,description,created_at) VALUES (?,?,?,?)",
    ).bind(`perm-${crypto.randomUUID()}`, capability, capability, NOW),
    env.DB.prepare(
      "INSERT INTO role_permission (role_id,permission_id) SELECT ?,id FROM permission WHERE code=?",
    ).bind(roleId, capability),
  ]);
  return { ...principal, staffId, roleId, scopeId };
}

type JobOptions = {
  mode?: "INSTANT" | "SCHEDULED";
  cycleId?: string | null;
  locationId?: string;
  status?: string;
  version?: number;
  stopVersion?: number;
  latitude?: number | null;
  longitude?: number | null;
  batchId?: string | null;
  sequence?: number | null;
  stopStatus?: string;
};
async function seedJob(options: JobOptions = {}) {
  const id = `job-${crypto.randomUUID()}`;
  const mode = options.mode ?? "SCHEDULED";
  const cycleId =
    options.cycleId === undefined ? (mode === "INSTANT" ? null : CYCLE) : options.cycleId;
  const batchId = options.batchId ?? null;
  const sequence = batchId === null ? null : (options.sequence ?? 1);
  const status = options.status ?? "UNASSIGNED";
  const version = options.version ?? 1;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO delivery_job (id,order_id,batch_id,sequence,cycle_id,fulfillment_mode,location_id,zone_id,rider_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,'RESOLVED',?,?,?,?)",
    ).bind(
      id,
      `order-${id}`,
      batchId,
      sequence,
      cycleId,
      mode,
      options.locationId ?? LOCATION,
      ZONE,
      status,
      JSON.stringify({ address: "sensitive-address" }),
      version,
      NOW,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO delivery_stop (id,delivery_job_id,batch_id,sequence,latitude,longitude,address_snapshot_json,contact_snapshot_json,instructions_snapshot,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      `stop-${id}`,
      id,
      batchId,
      sequence,
      options.latitude === undefined ? 10.3157 : options.latitude,
      options.longitude === undefined ? 123.8854 : options.longitude,
      JSON.stringify({ address: "sensitive-address" }),
      JSON.stringify({ phone: "+639171234567" }),
      JSON.stringify({ note: "sensitive-instruction" }),
      options.stopStatus ?? status,
      options.stopVersion ?? version,
      NOW,
      NOW,
    ),
  ]);
  return { id, stopId: `stop-${id}`, version };
}

async function seedBatch(status: string, cycleId: string = CYCLE) {
  const id = `batch-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO delivery_batch (id,fulfillment_mode,cycle_id,location_id,zone_id,status,context_resolution_status,version,created_at,updated_at) VALUES (?,'SCHEDULED',?,?,?,?,'RESOLVED',1,?,?)",
  )
    .bind(id, cycleId, LOCATION, ZONE, status, NOW, NOW)
    .run();
  return id;
}

async function seedFixtures() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO fulfillment_location (id,market_id,code,name,type,latitude,longitude,status,version,created_at,updated_at) VALUES (?,'market-metro-cebu','BATCH-WEST','Batch West','DISPATCH_ONLY',10,123,'active',1,?,?)",
    ).bind(WEST, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO delivery_cycle (id,market_id,name,order_opens_at,cutoff_at,delivery_date,status,capacity,allocated,version) VALUES (?,'market-metro-cebu','Other',?,?,?,'OPEN',100,0,1)",
    ).bind(OTHER_CYCLE, NOW - 1, NOW + 1, NOW + 10),
    env.DB.prepare(
      "INSERT INTO cycle_zone_capacity (cycle_id,zone_id,location_id,capacity,allocated,version) VALUES (?,?,?,100,0,1)",
    ).bind(OTHER_CYCLE, ZONE, LOCATION),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-app',NULL,NULL,'Application Rider',NULL,'ACTIVE',1,?,?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-inactive',NULL,NULL,'Inactive',?,'SUSPENDED',1,?,?)",
    ).bind(LOCATION, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO rider_identity (id,staff_id,auth_user_id,display_name,preferred_location_id,status,version,created_at,updated_at) VALUES ('rider-west',NULL,NULL,'West',?,'ACTIVE',1,?,?)",
    ).bind(WEST, NOW, NOW),
  ]);
  const manager = await seedStaff("delivery.manage");
  managerCookie = manager.cookie;
  managerStaffId = manager.staffId;
  managerRoleId = manager.roleId;
  managerScopeId = manager.scopeId;
  deniedCookie = (await seedStaff("delivery.read")).cookie;
}

beforeEach(async () => {
  if (!seeded) {
    await seedFixtures();
    seeded = true;
  }
});

function req(
  deliveries: ReadonlyArray<{ jobId: string; expectedVersion: number }>,
  overrides: Partial<CreateAndAssignDeliveryBatchRequest> = {},
): CreateAndAssignDeliveryBatchRequest {
  return {
    requestId: crypto.randomUUID(),
    headers: { cookie: managerCookie },
    locationId: LOCATION,
    fulfillmentMode: "SCHEDULED",
    cycleId: CYCLE,
    riderId: "rider-app",
    orderedDeliveries: deliveries,
    idempotencyKey: `assign-${crypto.randomUUID()}`,
    ...overrides,
  } as CreateAndAssignDeliveryBatchRequest;
}

async function direct(
  input: CreateAndAssignDeliveryBatchRequest,
  beforeCommit?: () => Promise<void>,
  database: D1Database = env.DB,
) {
  return createAndAssignDeliveryBatch(
    { auth: createAuth(env as Env & AuthEnvironment), db: database, now: () => NOW, beforeCommit },
    input,
  );
}

function countingDatabase(onBatch: (statementCount: number) => void): D1Database {
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return (statements: D1PreparedStatement[]) => {
          onBatch(statements.length);
          return target.batch(statements);
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function snapshot(jobIds: readonly string[], key: string) {
  const p = jobIds.length === 0 ? "NULL" : jobIds.map(() => "?").join(",");
  return env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM delivery_batch) batches,
       (SELECT COUNT(*) FROM delivery_event) events,
       (SELECT COUNT(*) FROM audit_event) audits,
       (SELECT COUNT(*) FROM idempotency_records WHERE scope='delivery.createAndAssignBatch' AND idempotency_key=?) idempotency,
       (SELECT GROUP_CONCAT(id||':'||status||':'||version||':'||COALESCE(batch_id,'-')||':'||COALESCE(sequence,'-')||':'||COALESCE(rider_id,'-')||':'||COALESCE(rider_user_id,'-'),'|') FROM delivery_job WHERE id IN (${p})) jobs,
       (SELECT GROUP_CONCAT(delivery_job_id||':'||status||':'||version||':'||COALESCE(batch_id,'-')||':'||COALESCE(sequence,'-')||':'||COALESCE(CAST(latitude AS TEXT),'NULL')||':'||COALESCE(CAST(longitude AS TEXT),'NULL')||':'||address_snapshot_json||':'||contact_snapshot_json||':'||instructions_snapshot,'|') FROM delivery_stop WHERE delivery_job_id IN (${p})) stops`,
  )
    .bind(key, ...jobIds, ...jobIds)
    .first();
}

async function expectFailureWithoutMutation(
  input: CreateAndAssignDeliveryBatchRequest,
  code: string,
  invoke: () => Promise<unknown> = () => core.createAndAssignDeliveryBatch(input),
) {
  const jobIds = input.orderedDeliveries.map((entry) => entry.jobId);
  const before = await snapshot(jobIds, input.idempotencyKey);
  await expect(invoke()).resolves.toMatchObject({ ok: false, error: { code } });
  expect(await snapshot(jobIds, input.idempotencyKey)).toEqual(before);
}

describe("create and assign delivery batch", () => {
  it("keeps 1-job and 24-job material batches within a constant Free-plan query budget", async () => {
    const counts = new Map<string, number>();
    for (const mode of ["INSTANT", "SCHEDULED"] as const) {
      for (const count of [1, 24]) {
        const jobs = await Promise.all(
          Array.from({ length: count }, () =>
            seedJob({ mode, cycleId: mode === "INSTANT" ? null : CYCLE }),
          ),
        );
        const input = req(
          jobs.map((job) => ({ jobId: job.id, expectedVersion: job.version })),
          { fulfillmentMode: mode, cycleId: mode === "INSTANT" ? null : CYCLE },
        );
        const result = await direct(
          input,
          undefined,
          countingDatabase((statementCount) => counts.set(`${mode}-${count}`, statementCount)),
        );
        expect(result.ok).toBe(true);
      }
    }
    expect(counts.get("INSTANT-24")).toBeLessThanOrEqual(20);
    expect(counts.get("SCHEDULED-24")).toBeLessThanOrEqual(20);
    expect(counts.get("INSTANT-24")).toBe(counts.get("INSTANT-1"));
    expect(counts.get("SCHEDULED-24")).toBe(counts.get("SCHEDULED-1"));
    expect(Object.fromEntries(counts)).toEqual({
      "INSTANT-1": 17,
      "INSTANT-24": 17,
      "SCHEDULED-1": 17,
      "SCHEDULED-24": 17,
    });
  });

  it("assigns a retry job atomically to an application-only Rider with scoped private audit", async () => {
    const job = await seedJob({ status: "RETRY_SCHEDULED", version: 7, stopVersion: 11 });
    const input = req([{ jobId: job.id, expectedVersion: 7 }]);
    const result = await core.createAndAssignDeliveryBatch(input);
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "ASSIGNED",
        version: 3,
        rider: { riderId: "rider-app" },
        orderedDeliveries: [
          { jobId: job.id, stopId: job.stopId, sequence: 1, status: "ASSIGNED", version: 8 },
        ],
      },
    });
    if (!result.ok) return;
    const row = await env.DB.prepare(
      "SELECT j.rider_user_id,j.version job_version,s.version stop_version,e.metadata_json,a.details_json,a.location_id,a.market_id FROM delivery_job j JOIN delivery_stop s ON s.delivery_job_id=j.id JOIN delivery_event e ON e.delivery_job_id=j.id JOIN audit_event a ON a.aggregate_id=j.batch_id WHERE j.id=? AND e.idempotency_key=?",
    )
      .bind(job.id, `${input.idempotencyKey}:job:${job.id}`)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      rider_user_id: null,
      job_version: 8,
      stop_version: 12,
      location_id: LOCATION,
      market_id: "market-metro-cebu",
    });
    const metadata = `${row?.metadata_json}${row?.details_json}`;
    expect(metadata).toContain('"transitions":["DRAFT","READY","ASSIGNED"]');
    for (const sensitive of [
      "sensitive-address",
      "+639171234567",
      "sensitive-instruction",
      "latitude",
      "longitude",
      "token",
    ])
      expect(metadata).not.toContain(sensitive);
  });

  it("preserves exact order for 24 Instant deliveries with a null cycle", async () => {
    const jobs: Awaited<ReturnType<typeof seedJob>>[] = [];
    for (let i = 1; i <= 24; i += 1)
      jobs.push(await seedJob({ mode: "INSTANT", cycleId: null, version: i, stopVersion: 30 + i }));
    const ordered = [...jobs]
      .reverse()
      .map((job) => ({ jobId: job.id, expectedVersion: job.version }));
    const input = req(ordered, { fulfillmentMode: "INSTANT", cycleId: null });
    const beforeStops = await env.DB.prepare(
      `SELECT delivery_job_id,address_snapshot_json,contact_snapshot_json,instructions_snapshot,latitude,longitude
       FROM delivery_stop WHERE delivery_job_id IN (${jobs.map(() => "?").join(",")}) ORDER BY delivery_job_id`,
    )
      .bind(...jobs.map((job) => job.id))
      .all();
    const result = await core.createAndAssignDeliveryBatch(input);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.orderedDeliveries.map((x) => [x.jobId, x.sequence])).toEqual(
        ordered.map((x, i) => [x.jobId, i + 1]),
      );
    if (!result.ok) return;
    const persisted = await env.DB.prepare(
      `SELECT j.id,j.sequence,j.version job_version,j.rider_id,s.sequence stop_sequence,
              s.version stop_version,s.status stop_status
       FROM delivery_job j JOIN delivery_stop s ON s.delivery_job_id=j.id
       WHERE j.batch_id=? ORDER BY j.sequence`,
    )
      .bind(result.value.batchId)
      .all<Record<string, unknown>>();
    expect(persisted.results).toHaveLength(24);
    expect(persisted.results).toEqual(
      ordered.map((entry, index) => {
        const original = jobs.find((job) => job.id === entry.jobId)!;
        return {
          id: entry.jobId,
          sequence: index + 1,
          job_version: original.version + 1,
          rider_id: "rider-app",
          stop_sequence: index + 1,
          stop_version: 31 + Number(original.version),
          stop_status: "ASSIGNED",
        };
      }),
    );
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count,COUNT(DISTINCT id) unique_ids,COUNT(DISTINCT idempotency_key) unique_keys FROM delivery_event WHERE metadata_json LIKE ?",
      )
        .bind(`%${result.value.batchId}%`)
        .first(),
    ).toMatchObject({ count: 24, unique_ids: 24, unique_keys: 24 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM audit_event WHERE aggregate_id=? AND action='DELIVERY.BATCH_CREATED_AND_ASSIGNED'",
      )
        .bind(result.value.batchId)
        .first(),
    ).toMatchObject({ count: 1 });
    const afterStops = await env.DB.prepare(
      `SELECT delivery_job_id,address_snapshot_json,contact_snapshot_json,instructions_snapshot,latitude,longitude
       FROM delivery_stop WHERE delivery_job_id IN (${jobs.map(() => "?").join(",")}) ORDER BY delivery_job_id`,
    )
      .bind(...jobs.map((job) => job.id))
      .all();
    expect(afterStops.results).toEqual(beforeStops.results);
  });

  it.each([
    ["empty", []],
    ["25", Array.from({ length: 25 }, (_, i) => ({ jobId: `${i}`, expectedVersion: 1 }))],
    [
      "duplicate",
      [
        { jobId: "x", expectedVersion: 1 },
        { jobId: "x", expectedVersion: 1 },
      ],
    ],
  ])("rejects %s selections", async (_name, ordered) => {
    await expectFailureWithoutMutation(req(ordered), "VALIDATION_FAILED");
  });

  it.each([
    null,
    { fulfillmentMode: "MIXED", cycleId: null },
    { fulfillmentMode: "INSTANT", cycleId: CYCLE },
    { fulfillmentMode: "SCHEDULED", cycleId: null },
    { origin: { latitude: 1, longitude: 2 } },
    { status: "DRAFT" },
    { orderedDeliveries: [{ jobId: "x", expectedVersion: 1, latitude: 10 }] },
    { orderedDeliveries: [{ jobId: "x", expectedVersion: 0 }] },
  ])("strictly rejects malformed/extra runtime shapes", async (override) => {
    const input =
      override === null ? null : { ...req([{ jobId: "x", expectedVersion: 1 }]), ...override };
    const key = input?.idempotencyKey ?? "invalid-null-request";
    const before = await snapshot([], key);
    await expect(core.createAndAssignDeliveryBatch(input as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(await snapshot([], key)).toEqual(before);
  });

  it("requires delivery.manage only and conceals missing/out-of-scope locations", async () => {
    const job = await seedJob();
    await expectFailureWithoutMutation(
      req([{ jobId: job.id, expectedVersion: 1 }], { headers: {} }),
      "UNAUTHENTICATED",
    );
    await expectFailureWithoutMutation(
      req([{ jobId: job.id, expectedVersion: 1 }], { headers: { cookie: deniedCookie } }),
      "FORBIDDEN",
    );
    for (const locationId of [WEST, "location-missing"])
      await expectFailureWithoutMutation(
        req([{ jobId: job.id, expectedVersion: 1 }], { locationId }),
        "NOT_FOUND",
      );
  });

  it.each(["rider-inactive", "rider-west", "rider-missing"])(
    "rejects unavailable Rider %s",
    async (riderId) => {
      const job = await seedJob();
      await expectFailureWithoutMutation(
        req([{ jobId: job.id, expectedVersion: 1 }], { riderId }),
        "NOT_FOUND",
      );
    },
  );

  it("accepts only canonical Rider IDs, never Staff/Auth compatibility IDs", async () => {
    const job = await seedJob();
    await expectFailureWithoutMutation(
      req([{ jobId: job.id, expectedVersion: 1 }], { riderId: managerStaffId }),
      "NOT_FOUND",
    );
  });

  it.each([
    ["ASSIGNED", "ILLEGAL_TRANSITION"],
    ["FAILED", "ILLEGAL_TRANSITION"],
    ["DELIVERED", "ILLEGAL_TRANSITION"],
    ["CANCELED", "ILLEGAL_TRANSITION"],
  ])("rejects state %s without mutation", async (status, code) => {
    const job = await seedJob({ status });
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
  });

  it("rejects active/mismatched/inconsistent containing batches", async () => {
    const active = await seedJob({
      status: "RETRY_SCHEDULED",
      batchId: await seedBatch("ASSIGNED"),
    });
    const mismatch = await seedJob({
      status: "RETRY_SCHEDULED",
      batchId: await seedBatch("COMPLETED", OTHER_CYCLE),
    });
    for (const job of [active, mismatch])
      await expectFailureWithoutMutation(req([{ jobId: job.id, expectedVersion: 1 }]), "CONFLICT");
    const inconsistent = await seedJob({
      status: "RETRY_SCHEDULED",
      batchId: await seedBatch("CANCELED"),
    });
    await env.DB.prepare(
      "UPDATE delivery_stop SET batch_id=NULL,sequence=NULL WHERE delivery_job_id=?",
    )
      .bind(inconsistent.id)
      .run();
    await expectFailureWithoutMutation(
      req([{ jobId: inconsistent.id, expectedVersion: 1 }]),
      "CONFLICT",
    );
  });

  it("rejects missing stop/coordinate, stale version, and mixed location/mode/cycle", async () => {
    const missingCoordinate = await seedJob({ latitude: null, longitude: null });
    const missingStop = await seedJob();
    await env.DB.prepare("DELETE FROM delivery_stop WHERE delivery_job_id=?")
      .bind(missingStop.id)
      .run();
    const stale = await seedJob({ version: 4 });
    const west = await seedJob({ locationId: WEST });
    const instant = await seedJob({ mode: "INSTANT", cycleId: null });
    const otherCycle = await seedJob({ cycleId: OTHER_CYCLE });
    for (const [job, version, code] of [
      [missingCoordinate, 1, "VALIDATION_FAILED"],
      [missingStop, 1, "CONFLICT"],
      [stale, 3, "STALE_VERSION"],
      [west, 1, "NOT_FOUND"],
      [instant, 1, "NOT_FOUND"],
      [otherCycle, 1, "NOT_FOUND"],
    ] as const)
      await expectFailureWithoutMutation(req([{ jobId: job.id, expectedVersion: version }]), code);
    const good = await seedJob();
    await expectFailureWithoutMutation(
      req([
        { jobId: good.id, expectedVersion: 1 },
        { jobId: west.id, expectedVersion: 1 },
      ]),
      "NOT_FOUND",
    );
  });

  it("replays the authoritative result and detects changed hash and processing", async () => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const first = await core.createAndAssignDeliveryBatch(input);
    expect(first.ok).toBe(true);
    await env.DB.prepare(
      "UPDATE rider_identity SET display_name='Authoritative Rider' WHERE id='rider-app'",
    ).run();
    await expect(
      core.createAndAssignDeliveryBatch({ ...input, requestId: crypto.randomUUID() }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        batchId: first.ok ? first.value.batchId : "",
        rider: { displayName: "Authoritative Rider" },
      },
    });
    const changed = {
      ...input,
      requestId: crypto.randomUUID(),
      orderedDeliveries: [...input.orderedDeliveries].reverse(),
      riderId: "rider-west",
    };
    await expectFailureWithoutMutation(changed, "IDEMPOTENCY_CONFLICT");
    const pendingJob = await seedJob();
    const pending = req([{ jobId: pendingJob.id, expectedVersion: 1 }]);
    const hash = await requestHash({
      actorStaffId: managerStaffId,
      locationId: LOCATION,
      fulfillmentMode: "SCHEDULED",
      cycleId: CYCLE,
      riderId: "rider-app",
      orderedDeliveries: pending.orderedDeliveries,
    });
    await env.DB.prepare(
      "INSERT INTO idempotency_records (scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES ('delivery.createAndAssignBatch',?,?,'delivery_batch','PROCESSING',?,?)",
    )
      .bind(pending.idempotencyKey, hash, NOW, NOW)
      .run();
    await expectFailureWithoutMutation(pending, "CONFLICT");
  });

  it("has exactly one concurrent different-key winner", async () => {
    const job = await seedJob();
    const inputs = [
      req([{ jobId: job.id, expectedVersion: 1 }]),
      req([{ jobId: job.id, expectedVersion: 1 }]),
    ];
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
    };
    const results = await Promise.all(inputs.map((input) => direct(input, barrier)));
    expect(arrivals).toBe(2);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok)).toEqual([
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "STALE_VERSION" }),
      }),
    ]);
    const loser = inputs[results.findIndex((result) => !result.ok)];
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE scope='delivery.createAndAssignBatch' AND idempotency_key=?",
      )
        .bind(loser.idempotencyKey)
        .first(),
    ).toMatchObject({ count: 0 });
    expect(
      await env.DB.prepare("SELECT status,version,sequence FROM delivery_job WHERE id=?")
        .bind(job.id)
        .first(),
    ).toMatchObject({ status: "ASSIGNED", version: 2, sequence: 1 });
  });

  it("uses stop CAS and rolls back the material transaction", async () => {
    const job = await seedJob({ version: 3, stopVersion: 8 });
    const input = req([{ jobId: job.id, expectedVersion: 3 }]);
    let racedSnapshot: Awaited<ReturnType<typeof snapshot>> | null = null;
    const result = await direct(input, async () => {
      await env.DB.prepare("UPDATE delivery_stop SET version=version+1 WHERE id=?")
        .bind(job.stopId)
        .run();
      racedSnapshot = await snapshot([job.id], input.idempotencyKey);
    });
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(await snapshot([job.id], input.idempotencyKey)).toEqual(racedSnapshot);
  });

  it("uses the containing batch version as a late CAS guard", async () => {
    const oldBatchId = await seedBatch("COMPLETED");
    const job = await seedJob({ status: "RETRY_SCHEDULED", batchId: oldBatchId });
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    let racedSnapshot: Awaited<ReturnType<typeof snapshot>> | null = null;
    const result = await direct(input, async () => {
      await env.DB.prepare("UPDATE delivery_batch SET version=version+1 WHERE id=?")
        .bind(oldBatchId)
        .run();
      racedSnapshot = await snapshot([job.id], input.idempotencyKey);
    });
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(await snapshot([job.id], input.idempotencyKey)).toEqual(racedSnapshot);
  });

  it.each(["job", "stop", "old-batch"] as const)(
    "aborts all 24 bulk assignments when the last candidate has a late %s mismatch",
    async (raceKind) => {
      const oldBatchId = raceKind === "old-batch" ? await seedBatch("COMPLETED") : null;
      const jobs: Awaited<ReturnType<typeof seedJob>>[] = [];
      for (let index = 0; index < 24; index += 1)
        jobs.push(
          await seedJob(
            raceKind === "old-batch" && index === 23
              ? { status: "RETRY_SCHEDULED", batchId: oldBatchId }
              : {},
          ),
        );
      const input = req(jobs.map((job) => ({ jobId: job.id, expectedVersion: 1 })));
      let racedSnapshot: Awaited<ReturnType<typeof snapshot>> | null = null;
      const result = await direct(input, async () => {
        const last = jobs[23];
        if (raceKind === "job")
          await env.DB.prepare("UPDATE delivery_job SET version=version+1 WHERE id=?")
            .bind(last.id)
            .run();
        else if (raceKind === "stop")
          await env.DB.prepare("UPDATE delivery_stop SET version=version+1 WHERE id=?")
            .bind(last.stopId)
            .run();
        else
          await env.DB.prepare("UPDATE delivery_batch SET version=version+1 WHERE id=?")
            .bind(oldBatchId)
            .run();
        racedSnapshot = await snapshot(
          jobs.map((job) => job.id),
          input.idempotencyKey,
        );
      });
      expect(result).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
      expect(
        await snapshot(
          jobs.map((job) => job.id),
          input.idempotencyKey,
        ),
      ).toEqual(racedSnapshot);
    },
  );

  it("rolls back batch/job/stop/event/audit/idempotency on late audit failure", async () => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    await env.DB.exec(
      "CREATE TRIGGER fail_batch_audit BEFORE INSERT ON audit_event WHEN NEW.action='DELIVERY.BATCH_CREATED_AND_ASSIGNED' BEGIN SELECT RAISE(ABORT,'INJECTED'); END;",
    );
    try {
      await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_batch_audit;");
    }
    expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
  });

  it.each(["DRAFT", "SCHEDULED", "CANCELED", "CLOSED"])(
    "rejects non-operational Scheduled cycle state %s without mutation",
    async (status) => {
      const job = await seedJob();
      const input = req([{ jobId: job.id, expectedVersion: 1 }]);
      const prior = await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
        .bind(CYCLE)
        .first<{ status: string; version: number }>();
      const before = await snapshot([job.id], input.idempotencyKey);
      await env.DB.prepare("UPDATE delivery_cycle SET status=?,version=version+1 WHERE id=?")
        .bind(status, CYCLE)
        .run();
      try {
        await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
          ok: false,
          error: { code: "CONFLICT" },
        });
        expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
      } finally {
        await env.DB.prepare("UPDATE delivery_cycle SET status=?,version=? WHERE id=?")
          .bind(prior?.status, prior?.version, CYCLE)
          .run();
      }
    },
  );

  it.each([
    "OPEN",
    "CUTOFF_REACHED",
    "PROCUREMENT",
    "RECEIVING",
    "PACKING",
    "DISPATCHING",
    "DELIVERING",
  ])("permits canonical operational Scheduled cycle state %s", async (status) => {
    const job = await seedJob();
    const prior = await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
      .bind(CYCLE)
      .first<{ status: string; version: number }>();
    await env.DB.prepare("UPDATE delivery_cycle SET status=?,version=version+1 WHERE id=?")
      .bind(status, CYCLE)
      .run();
    try {
      await expect(
        core.createAndAssignDeliveryBatch(req([{ jobId: job.id, expectedVersion: 1 }])),
      ).resolves.toMatchObject({ ok: true, value: { status: "ASSIGNED" } });
    } finally {
      await env.DB.prepare("UPDATE delivery_cycle SET status=?,version=? WHERE id=?")
        .bind(prior?.status, prior?.version, CYCLE)
        .run();
    }
  });

  it("rejects an inactive requested location before mutation", async () => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    await env.DB.prepare("UPDATE fulfillment_location SET status='inactive' WHERE id=?")
      .bind(LOCATION)
      .run();
    try {
      await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
    } finally {
      await env.DB.prepare("UPDATE fulfillment_location SET status='active' WHERE id=?")
        .bind(LOCATION)
        .run();
    }
  });

  it("rejects unresolved job and containing batch contexts without mutation", async () => {
    const unresolvedJobId = `job-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO delivery_job (id,order_id,batch_id,sequence,cycle_id,fulfillment_mode,location_id,zone_id,rider_id,status,context_resolution_status,address_snapshot_json,version,created_at,updated_at) VALUES (?,?,NULL,NULL,NULL,'SCHEDULED',NULL,NULL,NULL,'ESCALATED','LEGACY_UNRESOLVED','{}',1,?,?)",
      ).bind(unresolvedJobId, `order-${unresolvedJobId}`, NOW, NOW),
      env.DB.prepare(
        "INSERT INTO delivery_stop (id,delivery_job_id,batch_id,sequence,latitude,longitude,address_snapshot_json,contact_snapshot_json,instructions_snapshot,status,version,created_at,updated_at) VALUES (?,?,NULL,NULL,10,123,'{}','{}','{}','ESCALATED',1,?,?)",
      ).bind(`stop-${unresolvedJobId}`, unresolvedJobId, NOW, NOW),
    ]);
    const unresolvedBatchId = `batch-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO delivery_batch (id,fulfillment_mode,cycle_id,location_id,zone_id,status,context_resolution_status,version,created_at,updated_at) VALUES (?,NULL,NULL,NULL,NULL,'EXCEPTION','LEGACY_UNRESOLVED',1,?,?)",
    )
      .bind(unresolvedBatchId, NOW, NOW)
      .run();
    const batched = await seedJob({
      status: "RETRY_SCHEDULED",
      batchId: unresolvedBatchId,
    });
    for (const [jobId, code] of [
      [unresolvedJobId, "NOT_FOUND"],
      [batched.id, "CONFLICT"],
    ] as const) {
      const input = req([{ jobId, expectedVersion: 1 }]);
      const before = await snapshot([jobId], input.idempotencyKey);
      await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
        ok: false,
        error: { code },
      });
      expect(await snapshot([jobId], input.idempotencyKey)).toEqual(before);
    }
  });

  it.each([
    ["out-of-range", 91, 123.8854],
    ["one-sided", 10.3157, null],
    ["nonfinite", Number.POSITIVE_INFINITY, 123.8854],
  ])(
    "rejects storage-corrupt %s coordinates without mutation",
    async (_name, latitude, longitude) => {
      await env.DB.exec("PRAGMA ignore_check_constraints=ON;");
      let job: Awaited<ReturnType<typeof seedJob>>;
      try {
        job = await seedJob({ latitude, longitude });
      } finally {
        await env.DB.exec("PRAGMA ignore_check_constraints=OFF;");
      }
      const input = req([{ jobId: job.id, expectedVersion: 1 }]);
      const before = await snapshot([job.id], input.idempotencyKey);
      await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_FAILED" },
      });
      expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
    },
  );

  it("fails closed when location authority changes after preflight", async () => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    try {
      await expect(
        direct(input, async () => {
          await env.DB.prepare("UPDATE fulfillment_location SET status='inactive' WHERE id=?")
            .bind(LOCATION)
            .run();
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
    } finally {
      await env.DB.prepare("UPDATE fulfillment_location SET status='active' WHERE id=?")
        .bind(LOCATION)
        .run();
    }
  });

  it.each([
    [
      "status",
      "UPDATE rider_identity SET status='SUSPENDED',version=version+1 WHERE id='rider-app'",
    ],
    [
      "preferred location",
      `UPDATE rider_identity SET preferred_location_id='${WEST}',version=version+1 WHERE id='rider-app'`,
    ],
  ])("fails closed when Rider %s changes after preflight", async (_name, sql) => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    try {
      await expect(direct(input, async () => void (await env.DB.exec(sql)))).resolves.toMatchObject(
        {
          ok: false,
          error: { code: "NOT_FOUND" },
        },
      );
      expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
    } finally {
      await env.DB.prepare(
        "UPDATE rider_identity SET status='ACTIVE',preferred_location_id=NULL,version=version+1 WHERE id='rider-app'",
      ).run();
    }
  });

  it("fails closed and conceals live IAM capability and scope changes", async () => {
    for (const change of ["capability", "scope"] as const) {
      const job = await seedJob();
      const input = req([{ jobId: job.id, expectedVersion: 1 }]);
      const before = await snapshot([job.id], input.idempotencyKey);
      try {
        await expect(
          direct(input, async () => {
            if (change === "capability")
              await env.DB.prepare("DELETE FROM role_permission WHERE role_id=?")
                .bind(managerRoleId)
                .run();
            else
              await env.DB.prepare("DELETE FROM staff_scope WHERE id=?").bind(managerScopeId).run();
          }),
        ).resolves.toMatchObject({
          ok: false,
          error: { code: change === "capability" ? "FORBIDDEN" : "NOT_FOUND" },
        });
        expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
      } finally {
        if (change === "capability")
          await env.DB.prepare(
            "INSERT INTO role_permission (role_id,permission_id) SELECT ?,id FROM permission WHERE code='delivery.manage'",
          )
            .bind(managerRoleId)
            .run();
        else
          await env.DB.prepare(
            "INSERT INTO staff_scope (id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'location',NULL,?)",
          )
            .bind(managerScopeId, managerStaffId, LOCATION)
            .run();
      }
    }
  });

  it.each([
    ["terminal state", "UPDATE delivery_cycle SET status='CLOSED',version=version+1 WHERE id=?"],
    ["version", "UPDATE delivery_cycle SET version=version+1 WHERE id=?"],
  ])("guards a Scheduled cycle %s race", async (_name, sql) => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    const prior = await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
      .bind(CYCLE)
      .first<{ status: string; version: number }>();
    try {
      await expect(
        direct(input, async () => void (await env.DB.prepare(sql).bind(CYCLE).run())),
      ).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
    } finally {
      await env.DB.prepare("UPDATE delivery_cycle SET status=?,version=? WHERE id=?")
        .bind(prior?.status, prior?.version, CYCLE)
        .run();
    }
  });

  it.each(["COMPLETED", "CANCELED"])("reuses a %s prior batch", async (status) => {
    const oldBatchId = await seedBatch(status);
    const job = await seedJob({ status: "RETRY_SCHEDULED", batchId: oldBatchId });
    const result = await core.createAndAssignDeliveryBatch(
      req([{ jobId: job.id, expectedVersion: 1 }]),
    );
    expect(result).toMatchObject({ ok: true, value: { status: "ASSIGNED" } });
    if (result.ok) expect(result.value.batchId).not.toBe(oldBatchId);
  });

  it("rolls back and classifies a late event failure as internal", async () => {
    const job = await seedJob();
    const input = req([{ jobId: job.id, expectedVersion: 1 }]);
    const before = await snapshot([job.id], input.idempotencyKey);
    await env.DB.exec(
      "CREATE TRIGGER fail_batch_event BEFORE INSERT ON delivery_event WHEN NEW.event_type='ASSIGNED' BEGIN SELECT RAISE(ABORT,'INJECTED'); END;",
    );
    try {
      await expect(core.createAndAssignDeliveryBatch(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_batch_event;");
    }
    expect(await snapshot([job.id], input.idempotencyKey)).toEqual(before);
  });
});
