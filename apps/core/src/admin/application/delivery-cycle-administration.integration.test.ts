import { describe, expect, it, onTestFinished } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { SaveAdminDeliveryCycleRequest } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
import { reachDueCycleCutoff } from "../../commerce/application/reach-due-cycle-cutoff";
import { operationalCandidates } from "../../geography/application/operational-candidates";
import { scheduleAdminDeliveryCycle } from "./delivery-cycle-administration";
import { createAuth } from "../../auth/service";

const core = exports.default;
async function manager(scope: "global" | "location" = "global") {
  const staff = await locationManager(scope);
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('fulfillment.read','fulfillment.manage')",
  )
    .bind(staff.id)
    .run();
  return staff;
}
function draft(headers: Record<string, string>): SaveAdminDeliveryCycleRequest {
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  return {
    headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    reason: "Plan weekly deliveries",
    expectedVersion: 0,
    marketId: "market-metro-cebu",
    name: `Weekly ${crypto.randomUUID()}`,
    orderOpensAt: at(1),
    cutoffAt: at(24),
    procurementAt: at(25),
    preparationAt: at(30),
    pickupAt: at(32),
    windows: [{ name: "Afternoon", startsAt: at(33), endsAt: at(35) }],
    participation: [{ zoneId: "zone-cebu-city-core", locationId: "location-cebu-central" }],
  };
}
async function noEffects(request: SaveAdminDeliveryCycleRequest) {
  expect(
    await env.DB.prepare("SELECT count(*) count FROM delivery_cycle WHERE name=?")
      .bind(request.name)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?")
      .bind(request.idempotencyKey)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
      .bind(request.idempotencyKey)
      .first(),
  ).toEqual({ count: 0 });
}
describe("Global cycle administration", () => {
  it("opens and cuts off at exact boundaries through the saved and scheduled commands", async () => {
    const staff = await manager();
    const request = draft(staff.headers);
    const saved = await core.saveAdminDeliveryCycleDraft(request);
    if (!saved.ok) throw new Error("Draft failed");
    expect(
      await core.scheduleAdminDeliveryCycle({
        headers: staff.headers,
        requestId: crypto.randomUUID(),
        cycleId: saved.value.cycleId,
        expectedVersion: 1,
        reason: "Checked schedule",
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    const opens = Date.parse(request.orderOpensAt),
      cutoff = Date.parse(request.cutoffAt);
    expect(await openDueDeliveryCycles(env.DB, opens - 1)).toBe(0);
    expect(await openDueDeliveryCycles(env.DB, opens)).toBe(1);
    const candidates = (now: number) =>
      operationalCandidates(
        env.DB,
        { latitude: 10.32, longitude: 123.9 },
        { mode: "SCHEDULED", cycleId: saved.value.cycleId, now },
      );
    expect(await candidates(opens - 1)).toHaveLength(0);
    expect((await candidates(opens)).length).toBeGreaterThan(0);
    expect((await candidates(cutoff - 1)).length).toBeGreaterThan(0);
    expect(await candidates(cutoff)).toHaveLength(0);
    expect(await candidates(cutoff + 1)).toHaveLength(0);
    expect(await openDueDeliveryCycles(env.DB, opens + 1)).toBe(0);
    expect(await reachDueCycleCutoff(env.DB, cutoff - 1)).toBe(0);
    expect(await reachDueCycleCutoff(env.DB, cutoff)).toBe(1);
    expect(await reachDueCycleCutoff(env.DB, cutoff + 1)).toBe(0);
    expect(
      await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
        .bind(saved.value.cycleId)
        .first(),
    ).toEqual({ status: "CUTOFF_REACHED", version: 4 });
    expect(
      await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE aggregate_id=?")
        .bind(saved.value.cycleId)
        .first(),
    ).toEqual({ count: 4 });
  });
  it.each(["opening", "cutoff"])(
    "does not advance %s without its audit, then recovers",
    async (transition) => {
      const staff = await manager();
      const request = draft(staff.headers);
      const saved = await core.saveAdminDeliveryCycleDraft(request);
      if (!saved.ok) throw new Error("Draft failed");
      expect(
        await core.scheduleAdminDeliveryCycle({
          headers: staff.headers,
          requestId: crypto.randomUUID(),
          cycleId: saved.value.cycleId,
          expectedVersion: 1,
          reason: "Checked schedule",
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
      const run =
        transition === "opening"
          ? () => openDueDeliveryCycles(env.DB, Date.parse(request.orderOpensAt))
          : () => reachDueCycleCutoff(env.DB, Date.parse(request.cutoffAt));
      onTestFinished(async () => {
        await env.DB.prepare("UPDATE delivery_cycle SET status='CLOSED' WHERE id=?")
          .bind(saved.value.cycleId)
          .run();
      });
      if (transition === "cutoff")
        await openDueDeliveryCycles(env.DB, Date.parse(request.orderOpensAt));
      await env.DB.exec(
        "CREATE TRIGGER ignore_cycle_clock_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(IGNORE); END;",
      );
      try {
        await expect(run()).rejects.toThrow();
        expect(
          await env.DB.prepare("SELECT status FROM delivery_cycle WHERE id=?")
            .bind(saved.value.cycleId)
            .first(),
        ).toEqual({ status: transition === "opening" ? "SCHEDULED" : "OPEN" });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_cycle_clock_audit");
      }
      expect(await run()).toBe(1);
      expect(await run()).toBe(0);
    },
  );
  it("creates, edits, schedules and returns original receipts after later transitions", async () => {
    const staff = await manager();
    const request = draft(staff.headers);
    const saved = await core.saveAdminDeliveryCycleDraft(request);
    expect(saved).toMatchObject({ ok: true, value: { status: "DRAFT", version: 1 } });
    if (!saved.ok) throw new Error("Draft failed");
    const edit = {
      ...request,
      cycleId: saved.value.cycleId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      name: "Revised weekly deliveries",
    };
    const edited = await core.saveAdminDeliveryCycleDraft(edit);
    expect(edited).toMatchObject({ ok: true, value: { version: 2 } });
    const schedule = {
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      cycleId: saved.value.cycleId,
      expectedVersion: 2,
      reason: "Publish checked plan",
      idempotencyKey: crypto.randomUUID(),
    };
    const scheduled = await core.scheduleAdminDeliveryCycle(schedule);
    expect(scheduled).toMatchObject({ ok: true, value: { status: "SCHEDULED", version: 3 } });
    expect(await core.saveAdminDeliveryCycleDraft(request)).toEqual(saved);
    expect(await core.saveAdminDeliveryCycleDraft(edit)).toEqual(edited);
    expect(await core.scheduleAdminDeliveryCycle(schedule)).toEqual(scheduled);
    expect(
      await core.saveAdminDeliveryCycleDraft({ ...edit, name: "Different intent" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await core.saveAdminDeliveryCycleDraft({
        ...edit,
        expectedVersion: 3,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    expect(
      await core.listAdminDeliveryCycles({
        headers: staff.headers,
        requestId: crypto.randomUUID(),
        rangeStart: new Date(Date.now() - 3_600_000).toISOString(),
        rangeEnd: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      }),
    ).toMatchObject({ ok: true, value: { canManage: true } });
    expect(
      await env.DB.prepare("SELECT capacity,allocated FROM delivery_cycle WHERE id=?")
        .bind(saved.value.cycleId)
        .first(),
    ).toEqual({ capacity: 0, allocated: 0 });
  });
  it("reads cycles that intersect the visible range and applies calendar filters", async () => {
    const staff = await manager();
    const request = draft(staff.headers);
    const saved = await core.saveAdminDeliveryCycleDraft(request);
    if (!saved.ok) throw new Error("Draft failed");
    const inside = await core.listAdminDeliveryCycles({
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      rangeStart: new Date(Date.parse(request.pickupAt) - 30 * 60_000).toISOString(),
      rangeEnd: new Date(Date.parse(request.windows[0]!.endsAt) + 30 * 60_000).toISOString(),
      marketId: request.marketId,
      locationId: request.participation[0]!.locationId,
      status: "DRAFT",
    });
    expect(inside).toMatchObject({
      ok: true,
      value: { items: [{ cycleId: saved.value.cycleId }], nextCursor: null },
    });
    const after = await core.listAdminDeliveryCycles({
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      rangeStart: new Date(Date.parse(request.windows[0]!.endsAt)).toISOString(),
      rangeEnd: new Date(Date.parse(request.windows[0]!.endsAt) + 3_600_000).toISOString(),
    });
    expect(after.ok).toBe(true);
    if (after.ok)
      expect(after.value.items.some((cycle) => cycle.cycleId === saved.value.cycleId)).toBe(false);
    expect(
      await core.listAdminDeliveryCycles({
        headers: staff.headers,
        requestId: crypto.randomUUID(),
        rangeStart: request.orderOpensAt,
        rangeEnd: request.windows[0]!.endsAt,
        locationId: "another-location",
      }),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });
  it("paginates more than one hundred cycles without losing the visible range", async () => {
    const staff = await manager();
    const base = Date.now() + 100 * 24 * 3_600_000;
    const prefix = `range-${crypto.randomUUID()}`;
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 105; index += 1) {
      const cycleId = `${prefix}-${index.toString().padStart(3, "0")}`;
      const opensAt = base + index * 60_000;
      const deliveryStart = opensAt + 24 * 3_600_000;
      statements.push(
        env.DB.prepare(
          "INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,cutoff_at,delivery_date,status,capacity,allocated,version) VALUES (?,'market-metro-cebu',?,?,?,?, 'DRAFT',0,0,1)",
        ).bind(cycleId, cycleId, opensAt, opensAt + 12 * 3_600_000, deliveryStart),
        env.DB.prepare(
          "INSERT INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at) VALUES (?,?, 'Scheduled delivery',?,?,?)",
        ).bind(`${cycleId}-window`, cycleId, deliveryStart, deliveryStart + 3_600_000, Date.now()),
      );
    }
    for (let index = 0; index < statements.length; index += 80)
      await env.DB.batch(statements.slice(index, index + 80));

    const query = {
      headers: staff.headers,
      rangeStart: new Date(base - 60_000).toISOString(),
      rangeEnd: new Date(base + 26 * 3_600_000).toISOString(),
    };
    const first = await core.listAdminDeliveryCycles({
      ...query,
      requestId: crypto.randomUUID(),
    });
    expect(first).toMatchObject({ ok: true, value: { items: { length: 100 } } });
    if (!first.ok || !first.value.nextCursor) throw new Error("Expected a second range page");
    const second = await core.listAdminDeliveryCycles({
      ...query,
      requestId: crypto.randomUUID(),
      cursor: first.value.nextCursor,
    });
    expect(second).toMatchObject({ ok: true, value: { items: { length: 5 }, nextCursor: null } });
    if (second.ok)
      expect(
        new Set([...first.value.items, ...second.value.items].map((cycle) => cycle.cycleId)).size,
      ).toBe(105);
  });
  it.each([
    ["claim", "BEFORE INSERT ON idempotency_records"],
    ["cycle", "BEFORE INSERT ON delivery_cycle"],
    ["schedule", "BEFORE INSERT ON delivery_cycle_schedule"],
    ["window", "BEFORE INSERT ON delivery_cycle_window"],
    ["participation", "BEFORE INSERT ON delivery_cycle_zone"],
    ["audit", "BEFORE INSERT ON audit_event"],
    ["receipt", "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"],
  ])("rolls back an ignored %s and permits exact recovery", async (_effect, trigger) => {
    const staff = await manager();
    const request = draft(staff.headers);
    await env.DB.exec(
      `CREATE TRIGGER ignore_cycle_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    try {
      expect(await core.saveAdminDeliveryCycleDraft(request)).toMatchObject({ ok: false });
      await noEffects(request);
    } finally {
      await env.DB.exec("DROP TRIGGER ignore_cycle_effect");
    }
    const saved = await core.saveAdminDeliveryCycleDraft(request);
    expect(saved.ok).toBe(true);
    expect(await core.saveAdminDeliveryCycleDraft(request)).toEqual(saved);
  });
  it("rejects local authority, malformed chronology and warehouse participation", async () => {
    const local = await manager("location");
    const localRequest = draft(local.headers);
    expect(await core.saveAdminDeliveryCycleDraft(localRequest)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await noEffects(localRequest);
    const staff = await manager();
    const request = draft(staff.headers);
    expect(
      await core.saveAdminDeliveryCycleDraft({ ...request, cutoffAt: request.orderOpensAt }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await noEffects(request);
    expect(
      await core.saveAdminDeliveryCycleDraft({
        ...request,
        windows: [
          ...request.windows,
          {
            name: "Later delivery",
            startsAt: request.windows[0]!.startsAt,
            endsAt: request.windows[0]!.endsAt,
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await noEffects(request);
    expect(
      await core.saveAdminDeliveryCycleDraft({
        ...request,
        participation: [{ zoneId: "zone-cebu-city-core", locationId: "missing-warehouse" }],
      }),
    ).toMatchObject({ ok: false });
    await noEffects(request);
  });
  it("admits one competing draft update without a losing receipt", async () => {
    const staff = await manager();
    const request = draft(staff.headers);
    const saved = await core.saveAdminDeliveryCycleDraft(request);
    if (!saved.ok) throw new Error("Draft failed");
    const inputs = ["First revision", "Second revision"].map((name) => ({
      ...request,
      name,
      cycleId: saved.value.cycleId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    }));
    const results = await Promise.all(
      inputs.map((input) => core.saveAdminDeliveryCycleDraft(input)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT version FROM delivery_cycle WHERE id=?")
        .bind(saved.value.cycleId)
        .first(),
    ).toEqual({ version: 2 });
    for (const [index, result] of results.entries()) {
      const input = inputs[index];
      if (!input) throw new Error("Missing competing request");
      expect(
        await env.DB.prepare(
          "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
        )
          .bind(input.idempotencyKey)
          .first(),
      ).toEqual({ count: result.ok ? 1 : 0 });
    }
  });
  it.each(["authority", "participation", "window"])(
    "rejects changed %s at the scheduling write boundary and recovers",
    async (changed) => {
      const staff = await manager();
      const saved = await core.saveAdminDeliveryCycleDraft(draft(staff.headers));
      if (!saved.ok) throw new Error("Draft failed");
      const request = {
        headers: staff.headers,
        requestId: crypto.randomUUID(),
        cycleId: saved.value.cycleId,
        expectedVersion: 1,
        reason: "Reviewed schedule",
        idempotencyKey: crypto.randomUUID(),
      };
      const database = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (changed === "authority")
                await env.DB.prepare(
                  "UPDATE staff_scope SET scope_kind='location',location_id='location-cebu-central' WHERE staff_id=?",
                )
                  .bind(staff.id)
                  .run();
              else if (changed === "participation")
                await env.DB.prepare(
                  "UPDATE delivery_cycle_zone SET status='INACTIVE' WHERE cycle_id=?",
                )
                  .bind(saved.value.cycleId)
                  .run();
              else
                await env.DB.prepare(
                  "UPDATE delivery_cycle_window SET ends_at=ends_at+1 WHERE cycle_id=?",
                )
                  .bind(saved.value.cycleId)
                  .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await scheduleAdminDeliveryCycle({ auth: createAuth(env), db: database }, request),
      ).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
          .bind(saved.value.cycleId)
          .first(),
      ).toEqual({ status: "DRAFT", version: 1 });
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
      if (changed === "authority")
        await env.DB.prepare(
          "UPDATE staff_scope SET scope_kind='global',location_id=NULL WHERE staff_id=?",
        )
          .bind(staff.id)
          .run();
      else if (changed === "participation")
        await env.DB.prepare("UPDATE delivery_cycle_zone SET status='ACTIVE' WHERE cycle_id=?")
          .bind(saved.value.cycleId)
          .run();
      else
        await env.DB.prepare("UPDATE delivery_cycle_window SET ends_at=ends_at-1 WHERE cycle_id=?")
          .bind(saved.value.cycleId)
          .run();
      const scheduled = await core.scheduleAdminDeliveryCycle(request);
      expect(scheduled).toMatchObject({ ok: true });
      expect(await core.scheduleAdminDeliveryCycle(request)).toEqual(scheduled);
    },
  );
});
