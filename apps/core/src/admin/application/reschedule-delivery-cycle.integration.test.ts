import { env, exports } from "cloudflare:workers";
import { expect, it, onTestFinished } from "vitest";
import type {
  AdminDeliveryCycleView,
  RescheduleAdminDeliveryCycleRequest,
} from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
import { scheduledDeliveryDeadlineSql } from "../../delivery/application/delivery-retry-readiness";
import { rescheduleAdminDeliveryCycle } from "./delivery-cycle-administration";
import { createAuth } from "../../auth/service";

const core = exports.default;
async function setup() {
  const staff = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('fulfillment.read','fulfillment.manage','delivery.read','delivery.manage')",
  )
    .bind(staff.id)
    .run();
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const draft = {
    headers: staff.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    marketId: "market-metro-cebu",
    name: "Synthetic delivery schedule",
    orderOpensAt: at(-1),
    cutoffAt: at(1),
    procurementAt: at(2),
    preparationAt: at(3),
    pickupAt: at(4),
    windows: [{ name: "Delivery", startsAt: at(5), endsAt: at(6) }],
    participation: [{ zoneId: "zone-cebu-city-core", locationId: "location-cebu-central" }],
    expectedVersion: 0,
    reason: "Synthetic schedule",
  };
  const saved = await core.saveAdminDeliveryCycleDraft(draft);
  if (!saved.ok) throw new Error(saved.error.message);
  const activated = await core.scheduleAdminDeliveryCycle({
    ...draft,
    cycleId: saved.value.cycleId,
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!activated.ok) throw new Error(activated.error.message);
  await openDueDeliveryCycles(env.DB, now);
  const cycle: AdminDeliveryCycleView = { ...activated.value, status: "OPEN", version: 3 };
  const request: RescheduleAdminDeliveryCycleRequest = {
    ...draft,
    cycleId: cycle.cycleId,
    expectedVersion: cycle.version,
    idempotencyKey: crypto.randomUUID(),
    reason: "Extend ordering and delivery",
    cutoffAt: at(2),
    procurementAt: at(3),
    preparationAt: at(4),
    pickupAt: at(5),
    windows: [{ name: "Extended delivery", startsAt: at(6), endsAt: at(12) }],
  };
  onTestFinished(async () => {
    await env.DB.prepare("UPDATE delivery_cycle SET status='CLOSED' WHERE id=?")
      .bind(cycle.cycleId)
      .run();
  });
  return { staff, cycle, request, at };
}
async function facts(cycleId: string) {
  return Promise.all([
    env.DB.prepare("SELECT * FROM delivery_cycle WHERE id=?").bind(cycleId).first(),
    env.DB.prepare("SELECT * FROM delivery_cycle_schedule WHERE cycle_id=?").bind(cycleId).first(),
    env.DB.prepare("SELECT * FROM delivery_cycle_window WHERE cycle_id=?").bind(cycleId).first(),
  ]);
}
async function noReceipt(key: string) {
  expect(
    await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toEqual({ count: 0 });
}

it("edits every schedule field on an open cycle, preserves paid snapshots and extends actual delivery readiness", async () => {
  const { staff, cycle, request, at } = await setup();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(id, `auth-${id}`),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(id, id, id),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,status,total_minor,currency,created_at) VALUES (?,?,?,'SCHEDULED',?,'{}','COMMITTED',100,'PHP',1)",
    ).bind(id, id, id, cycle.cycleId),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot(order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,fulfillment_mode,sourcing_modes_json,created_at) VALUES (?,'location-cebu-central',?,'zone-cebu-city-core',?,?,'SCHEDULED','[\"PLANNED\"]',1)",
    ).bind(id, cycle.cycleId, Date.parse(cycle.cutoffAt), Date.parse(at(5))),
    env.DB.prepare(
      "INSERT INTO order_delivery_window_snapshot(order_id,cycle_id,window_id,name,timezone,starts_at,ends_at,pickup_at,created_at) VALUES (?,?,?,?,?,?,?,?,1)",
    ).bind(
      id,
      cycle.cycleId,
      cycle.windows[0].windowId,
      "Delivery",
      "Asia/Manila",
      Date.parse(at(-2)),
      Date.parse(at(-1)),
      Date.parse(at(-3)),
    ),
    env.DB.prepare(
      "INSERT INTO delivery_job(id,order_id,cycle_id,fulfillment_mode,location_id,zone_id,status,address_snapshot_json,version,created_at,updated_at) VALUES (?, ?, ?, 'SCHEDULED','location-cebu-central','zone-cebu-city-core','UNASSIGNED','{}',1,1,1)",
    ).bind(id, id, cycle.cycleId),
    env.DB.prepare(
      "INSERT INTO delivery_stop(id,delivery_job_id,latitude,longitude,address_snapshot_json,contact_snapshot_json,instructions_snapshot,status,version,created_at,updated_at) VALUES (?,?,10.3,123.9,'{}','{}','{}','UNASSIGNED',1,1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,'location-cebu-central','PACKED',1,1)",
    ).bind(id, id),
    env.DB.prepare("UPDATE grocery_order SET status='FULFILLMENT_READY' WHERE id=?").bind(id),
  ]);
  const original = await env.DB.prepare(
    "SELECT * FROM order_delivery_window_snapshot WHERE order_id=?",
  )
    .bind(id)
    .first();
  const deadline = () =>
    env.DB.prepare(
      `SELECT ${scheduledDeliveryDeadlineSql} deadline FROM delivery_job job WHERE job.id=?`,
    )
      .bind(id)
      .first();
  expect(await deadline()).toEqual({ deadline: Date.parse(at(-1)) });
  const manual = {
    headers: staff.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    locationId: "location-cebu-central",
    jobId: id,
    expectedVersion: 1,
    action: "ASSIGN" as const,
    personName: "Synthetic courier",
    phoneE164: "+639171110000",
  };
  expect(await core.manageManualDelivery(manual)).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_FAILED" },
  });
  const freshness = await env.DB.prepare(
    "SELECT revision FROM operational_revision WHERE location_id='location-cebu-central'",
  ).first<{ revision: number }>();
  const edited = await core.rescheduleAdminDeliveryCycle({ ...request, orderOpensAt: at(-2) });
  expect(edited).toMatchObject({
    ok: true,
    value: {
      status: "OPEN",
      version: 4,
      orderOpensAt: at(-2),
      cutoffAt: at(2),
      procurementAt: at(3),
      preparationAt: at(4),
      pickupAt: at(5),
      windows: [{ windowId: cycle.windows[0].windowId, endsAt: at(12) }],
    },
  });
  expect(await deadline()).toEqual({ deadline: Date.parse(at(12)) });
  expect(
    await env.DB.prepare("SELECT * FROM order_delivery_window_snapshot WHERE order_id=?")
      .bind(id)
      .first(),
  ).toEqual(original);
  expect(
    await env.DB.prepare("SELECT cutoff_at FROM order_fulfillment_snapshot WHERE order_id=?")
      .bind(id)
      .first(),
  ).toEqual({ cutoff_at: Date.parse(cycle.cutoffAt) });
  expect(
    await env.DB.prepare("SELECT version,total_minor,status FROM grocery_order WHERE id=?")
      .bind(id)
      .first(),
  ).toEqual({ version: 1, total_minor: 100, status: "FULFILLMENT_READY" });
  expect(
    await env.DB.prepare("SELECT version,status FROM delivery_job WHERE id=?").bind(id).first(),
  ).toEqual({ version: 1, status: "UNASSIGNED" });
  expect(
    await env.DB.prepare(
      "SELECT revision FROM operational_revision WHERE location_id='location-cebu-central'",
    ).first(),
  ).toEqual({ revision: freshness!.revision + 1 });
  expect(await core.manageManualDelivery(manual)).toMatchObject({
    ok: true,
    value: { status: "ACTIVE" },
  });
  const booked = await env.DB.prepare(
    "SELECT * FROM delivery_provider_dispatch WHERE delivery_job_id=?",
  )
    .bind(id)
    .first();
  const assigned = await env.DB.prepare("SELECT * FROM delivery_job WHERE id=?").bind(id).first();
  expect(
    await core.rescheduleAdminDeliveryCycle({
      ...request,
      expectedVersion: 4,
      idempotencyKey: crypto.randomUUID(),
      windows: [{ ...request.windows[0], endsAt: at(13) }],
    }),
  ).toMatchObject({ ok: true });
  expect(
    await env.DB.prepare("SELECT * FROM delivery_provider_dispatch WHERE delivery_job_id=?")
      .bind(id)
      .first(),
  ).toEqual(booked);
  expect(await env.DB.prepare("SELECT * FROM delivery_job WHERE id=?").bind(id).first()).toEqual(
    assigned,
  );
});

it("replays the original immutable result after another edit and rejects changed intent or stale versions", async () => {
  const { request, at } = await setup();
  const first = await core.rescheduleAdminDeliveryCycle(request);
  expect(first.ok).toBe(true);
  const second = await core.rescheduleAdminDeliveryCycle({
    ...request,
    expectedVersion: 4,
    idempotencyKey: crypto.randomUUID(),
    windows: [{ ...request.windows[0], endsAt: at(13) }],
  });
  expect(second.ok).toBe(true);
  expect(await core.rescheduleAdminDeliveryCycle(request)).toEqual(first);
  expect(
    await core.rescheduleAdminDeliveryCycle({ ...request, reason: "Different request" }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  expect(
    await core.rescheduleAdminDeliveryCycle({ ...request, idempotencyKey: crypto.randomUUID() }),
  ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
});

it.each(["cycle", "schedule", "window", "freshness", "audit", "receipt"])(
  "rolls back the complete edit when required %s write is ignored",
  async (effect) => {
    const { cycle, request } = await setup();
    const original = await facts(cycle.cycleId);
    const table =
      effect === "cycle"
        ? "delivery_cycle"
        : effect === "schedule"
          ? "delivery_cycle_schedule"
          : effect === "window"
            ? "delivery_cycle_window"
            : effect === "freshness"
              ? "operational_revision"
              : effect === "audit"
                ? "audit_event"
                : "idempotency_records";
    const action = effect === "audit" || effect === "freshness" ? "INSERT" : "UPDATE";
    await env.DB.exec(
      `CREATE TRIGGER ignore_schedule_edit BEFORE ${action} ON ${table} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await core.rescheduleAdminDeliveryCycle(request)).toMatchObject({ ok: false });
      expect(await facts(cycle.cycleId)).toEqual(original);
      await noReceipt(request.idempotencyKey);
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_schedule_edit;");
    }
    expect(await core.rescheduleAdminDeliveryCycle(request)).toMatchObject({ ok: true });
  },
);

it.each(["authority", "window", "participation", "version"])(
  "revalidates mutable %s at the write boundary",
  async (changed) => {
    const { staff, cycle, request } = await setup();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (changed === "authority")
              await env.DB.prepare("UPDATE staff_identity SET status='suspended' WHERE id=?")
                .bind(staff.id)
                .run();
            if (changed === "window")
              await env.DB.prepare(
                "UPDATE delivery_cycle_window SET ends_at=ends_at+1 WHERE cycle_id=?",
              )
                .bind(cycle.cycleId)
                .run();
            if (changed === "participation")
              await env.DB.prepare(
                "UPDATE delivery_cycle_zone SET status='INACTIVE' WHERE cycle_id=?",
              )
                .bind(cycle.cycleId)
                .run();
            if (changed === "version")
              await env.DB.prepare("UPDATE delivery_cycle SET version=version+1 WHERE id=?")
                .bind(cycle.cycleId)
                .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await rescheduleAdminDeliveryCycle({ auth: createAuth(env), db }, request),
    ).toMatchObject({ ok: false });
    await noReceipt(request.idempotencyKey);
    expect(
      await env.DB.prepare("SELECT cutoff_at FROM delivery_cycle WHERE id=?")
        .bind(cycle.cycleId)
        .first(),
    ).toEqual({ cutoff_at: Date.parse(cycle.cutoffAt) });
  },
);

it("extends ordering after cutoff before purchase, and does not reopen purchased demand", async () => {
  const { cycle, request, at } = await setup();
  await env.DB.prepare("UPDATE delivery_cycle SET status='CUTOFF_REACHED' WHERE id=?")
    .bind(cycle.cycleId)
    .run();
  expect(await core.rescheduleAdminDeliveryCycle(request)).toMatchObject({
    ok: true,
    value: { status: "OPEN" },
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE delivery_cycle SET status='CUTOFF_REACHED' WHERE id=?").bind(
      cycle.cycleId,
    ),
    env.DB.prepare(
      "INSERT INTO scheduled_week_completion(cycle_id,location_id,version,demand_line_count,paid_order_count,total_quantity_base,purchase_completed_at,purchase_actor_user_id) VALUES (?,'location-cebu-central',1,1,1,1,1,'synthetic-staff')",
    ).bind(cycle.cycleId),
  ]);
  const denied = { ...request, expectedVersion: 4, idempotencyKey: crypto.randomUUID() };
  expect(await core.rescheduleAdminDeliveryCycle(denied)).toMatchObject({
    ok: false,
    error: { code: "CONFLICT" },
  });
  await noReceipt(denied.idempotencyKey);
  const deliveryOnly = { ...denied, cutoffAt: at(-1), orderOpensAt: at(-2) };
  expect(await core.rescheduleAdminDeliveryCycle(deliveryOnly)).toMatchObject({
    ok: true,
    value: { status: "CUTOFF_REACHED" },
  });
});

it("rejects non-Global authority and invalid chronology without effects", async () => {
  const { request, cycle, at } = await setup();
  const staff = await locationManager("location");
  const denied = { ...request, headers: staff.headers, idempotencyKey: crypto.randomUUID() };
  expect(await core.rescheduleAdminDeliveryCycle(denied)).toMatchObject({ ok: false });
  await noReceipt(denied.idempotencyKey);
  const invalid = { ...request, cutoffAt: at(10), idempotencyKey: crypto.randomUUID() };
  expect(await core.rescheduleAdminDeliveryCycle(invalid)).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_FAILED" },
  });
  await noReceipt(invalid.idempotencyKey);
  expect(
    await env.DB.prepare("SELECT version FROM delivery_cycle WHERE id=?")
      .bind(cycle.cycleId)
      .first(),
  ).toEqual({ version: 3 });
});

async function startedPayment(cycleId: string, unreconciled = false) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,status,version,created_at,updated_at) VALUES (?,?,'Home','Synthetic','09','{}',10.3,123.9,'active',1,1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO cart(id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',1,1,1)",
    ).bind(id, id),
    env.DB.prepare(
      `INSERT INTO checkout_quote(id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,status,expires_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,'SCHEDULED','PHP',100,100,'[]','ACTIVE',?,?,1,1)`,
    ).bind(id, id, id, id, id, cycleId, Date.now() + 60_000, id),
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP',?,?,1,1)",
    ).bind(id, id, id, unreconciled ? "SUCCEEDED" : "PROCESSING", id),
    ...(unreconciled
      ? [
          env.DB.prepare(
            "INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,created_at,updated_at) VALUES (?,?,'COMMIT_ORDER','checkout_quote',?,'PENDING',?,1,1)",
          ).bind(id, id, id, id),
        ]
      : []),
  ]);
}
it.each([false, true])(
  "protects a started or unreconciled payment when shortening procurement (unreconciled=%s)",
  async (unreconciled) => {
    const { cycle, request, at } = await setup();
    await startedPayment(cycle.cycleId, unreconciled);
    const original = await facts(cycle.cycleId);
    const shorter = { ...request, cutoffAt: cycle.cutoffAt, procurementAt: at(1.5) };
    expect(await core.rescheduleAdminDeliveryCycle(shorter)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await facts(cycle.cycleId)).toEqual(original);
    await noReceipt(shorter.idempotencyKey);
    expect(await core.rescheduleAdminDeliveryCycle(request)).toMatchObject({ ok: true });
  },
);
it.each(["payment", "purchase"])(
  "revalidates %s admitted between review and the edit transaction",
  async (changed) => {
    const { cycle, request, at } = await setup();
    const reviewed =
      changed === "payment"
        ? { ...request, cutoffAt: cycle.cutoffAt, procurementAt: at(1.5) }
        : request;
    const original = await facts(cycle.cycleId);
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (changed === "payment") await startedPayment(cycle.cycleId);
            else
              await env.DB.prepare(
                "INSERT INTO scheduled_week_completion(cycle_id,location_id,version,demand_line_count,paid_order_count,total_quantity_base,purchase_completed_at,purchase_actor_user_id) VALUES (?,'location-cebu-central',1,1,1,1,1,'synthetic-staff')",
              )
                .bind(cycle.cycleId)
                .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(
      await rescheduleAdminDeliveryCycle({ db, auth: createAuth(env) }, reviewed),
    ).toMatchObject({ ok: false });
    expect(await facts(cycle.cycleId)).toEqual(original);
    await noReceipt(reviewed.idempotencyKey);
  },
);
