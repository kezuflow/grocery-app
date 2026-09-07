import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { aggregateAdminProcurementDemand } from "../../admin/application/operations-commands";
import { createProcurementRequirement } from "./create-procurement-requirement";
const core = exports.default;
async function fixture(cutoff = Date.now() - 1000) {
  const manager = await locationManager("location"),
    id = crypto.randomUUID();
  await seedTestCycle(env.DB, id);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.manage'",
    ).bind(manager.id),
    env.DB.prepare("UPDATE delivery_cycle SET cutoff_at=? WHERE id=?").bind(cutoff, id),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(id, id, id),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
    ).bind(id, id, id, id),
    env.DB.prepare(
      "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',1,100,100,500,'GRAM',500)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES (?,?,?,'location-cebu-central','pool-red-onion',500,'OPEN','EXACT_PAID_LINE',?,'sku-red-onion-500g',1,500,'GRAM',500,1)",
    ).bind(id, id, id, id),
  ]);
  return {
    manager,
    id,
    request: {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      cycleId: id,
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-red-onion",
      skuId: "sku-red-onion-500g",
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      reason: "Buy exact paid demand",
    },
  };
}
async function noEffects(cycleId: string, key: string) {
  expect(
    await env.DB.prepare("SELECT id FROM procurement_run WHERE delivery_cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM procurement_requirement WHERE delivery_cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?").bind(key).first(),
  ).toBeNull();
}
describe("procurement command transaction and recovery", () => {
  it("keeps the legacy RPC operational for committed Scheduled demand after a global mode switch", async () => {
    const { request, id } = await fixture();
    await env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='PAUSED',fulfillment_mode='INSTANT',cadence=NULL,version=version+1 WHERE id='global'",
    ).run();
    const command = { ...request, deliveryCycleId: id };
    const first = await core.createProcurementRequirement(command);
    expect(first).toMatchObject({
      ok: true,
      value: { id: expect.any(String), status: "AGGREGATED" },
    });
    expect(await core.createProcurementRequirement(command)).toEqual(first);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  it.each(["scope", "permission", "staff", "demand", "cutoff", "late-failure"] as const)(
    "rolls back every dependent effect on %s loss at the write boundary",
    async (kind) => {
      const { manager, id, request } = await fixture();
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "permission")
                await target
                  .prepare("DELETE FROM role_permission WHERE role_id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "staff")
                await target
                  .prepare("UPDATE staff_identity SET status='inactive' WHERE id=?")
                  .bind(manager.id)
                  .run();
              if (kind === "demand")
                await target
                  .prepare(
                    "UPDATE committed_demand SET status='CANCELED',version=version+1 WHERE id=?",
                  )
                  .bind(id)
                  .run();
              if (kind === "cutoff")
                await target
                  .prepare("UPDATE delivery_cycle SET cutoff_at=?,version=version+1 WHERE id=?")
                  .bind(Date.now() + 60000, id)
                  .run();
              return target.batch(
                kind === "late-failure"
                  ? [...statements, target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)")]
                  : statements,
              );
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await aggregateAdminProcurementDemand({ db: database, auth: createAuth(env) }, request),
      ).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      await noEffects(id, request.idempotencyKey);
      if (kind === "late-failure")
        expect(await core.aggregateAdminProcurementDemand(request)).toMatchObject({
          ok: true,
          value: { requiredQuantityBase: 500 },
        });
    },
  );
  it("allows aggregation exactly at cutoff and never before it", async () => {
    const { request, id } = await fixture(1000);
    const command = { ...request, deliveryCycleId: id };
    expect(await createProcurementRequirement(env.DB, command, { now: () => 999 })).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    await noEffects(id, request.idempotencyKey);
    expect(await createProcurementRequirement(env.DB, command, { now: () => 1000 })).toMatchObject({
      ok: true,
      value: { view: { requiredQuantityBase: 500 } },
    });
  });
  it("replays the original result after recalculation and rejects changed versions/reasons", async () => {
    const { request } = await fixture();
    const before = (
      await env.DB.prepare(
        "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
      ).all()
    ).results;
    const first = await core.aggregateAdminProcurementDemand(request);
    expect(first).toMatchObject({ ok: true, value: { version: 1, requiredQuantityBase: 500 } });
    expect(
      await core.aggregateAdminProcurementDemand({
        ...request,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await core.aggregateAdminProcurementDemand(request)).toEqual(first);
    expect(
      await core.aggregateAdminProcurementDemand({ ...request, expectedVersion: 1 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await core.aggregateAdminProcurementDemand({ ...request, reason: "Changed" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
        ).all()
      ).results,
    ).toEqual(before);
  });
  it("serializes competing creation without orphan runs or duplicate receipt records", async () => {
    const { request, id } = await fixture();
    const second = { ...request, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      core.aggregateAdminProcurementDemand(request),
      core.aggregateAdminProcurementDemand(second),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM procurement_run WHERE delivery_cycle_id=?")
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM receiving_record WHERE procurement_requirement_id IN (SELECT id FROM procurement_requirement WHERE delivery_cycle_id=?)",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?)",
      )
        .bind(request.idempotencyKey, second.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});
