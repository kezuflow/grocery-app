import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";

const core = exports.default;
const locationId = "location-cebu-central";

async function fixture() {
  const manager = await locationManager("location");
  const cycleId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  await seedTestCycle(env.DB, cycleId);
  const cutoff = Date.now() - 120_000;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('procurement.manage','fulfillment.manage','procurement.read','fulfillment.read')",
    ).bind(manager.id),
    env.DB.prepare("UPDATE delivery_cycle SET cutoff_at=? WHERE id=?").bind(cutoff, cycleId),
    env.DB.prepare(
      "INSERT INTO delivery_cycle_schedule(cycle_id,timezone,procurement_at,preparation_at,pickup_at,created_at,updated_at) VALUES (?,'Asia/Manila',?,?,?,?,?)",
    ).bind(cycleId, cutoff + 60_000, cutoff + 90_000, cutoff + 120_000, cutoff, cutoff),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(orderId, orderId),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(orderId, orderId, orderId),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
    ).bind(orderId, orderId, orderId, cycleId),
    env.DB.prepare(
      "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot) VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',1,100,100,500,'GRAM')",
    ).bind(orderId, orderId),
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,committed_at) VALUES (?,?,?,?,'pool-red-onion',500,'OPEN','EXACT_PAID_LINE',?,'sku-red-onion-500g',1,500,'GRAM',1)",
    ).bind(orderId, orderId, cycleId, locationId, orderId),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,?,'NOT_STARTED',1,1)",
    ).bind(orderId, orderId, locationId),
  ]);
  return { manager, cycleId, orderId };
}

describe("Scheduled purchase and per-order packing", () => {
  it("uses the editable procurement time to gate purchase, then packs one paid Order", async () => {
    const { manager, cycleId, orderId } = await fixture();
    const otherOrderId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
      ).bind(otherOrderId, otherOrderId),
      env.DB.prepare(
        "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
      ).bind(otherOrderId, otherOrderId, otherOrderId),
      env.DB.prepare(
        "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
      ).bind(otherOrderId, otherOrderId, otherOrderId, cycleId),
      env.DB.prepare(
        "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot) VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',1,100,100,500,'GRAM')",
      ).bind(otherOrderId, otherOrderId),
      env.DB.prepare(
        "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,committed_at) VALUES (?,?,?,?,'pool-red-onion',500,'OPEN','EXACT_PAID_LINE',?,'sku-red-onion-500g',1,500,'GRAM',1)",
      ).bind(otherOrderId, otherOrderId, cycleId, locationId, otherOrderId),
      env.DB.prepare(
        "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,?,'NOT_STARTED',1,1)",
      ).bind(otherOrderId, otherOrderId, locationId),
    ]);
    const base = { headers: manager.headers, requestId: crypto.randomUUID(), cycleId, locationId };
    await env.DB.prepare("UPDATE delivery_cycle_schedule SET procurement_at=? WHERE cycle_id=?")
      .bind(Date.now() + 60_000, cycleId)
      .run();
    expect(
      await core.completeAdminScheduledWeek({
        ...base,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    await env.DB.prepare("UPDATE delivery_cycle_schedule SET procurement_at=? WHERE cycle_id=?")
      .bind(Date.now() - 1_000, cycleId)
      .run();
    const purchase = { ...base, expectedVersion: 0, idempotencyKey: crypto.randomUUID() };
    const completed = await core.completeAdminScheduledWeek(purchase);
    expect(completed).toMatchObject({ ok: true, value: { paidOrderCount: 2, version: 1 } });
    expect(await core.completeAdminScheduledWeek(purchase)).toEqual(completed);
    const pack = {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      locationId,
      orderId,
      action: "COMPLETE_SCHEDULED_PACKING" as const,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    expect(await core.advanceAdminFulfillment(pack)).toMatchObject({
      ok: true,
      value: { status: "PACKED", version: 2 },
    });
    expect(await core.advanceAdminFulfillment(pack)).toMatchObject({
      ok: true,
      value: { status: "PACKED", version: 2 },
    });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "FULFILLMENT_READY" });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?")
        .bind(otherOrderId)
        .first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare("SELECT status FROM fulfillment_record WHERE order_id=?")
        .bind(otherOrderId)
        .first(),
    ).toEqual({ status: "NOT_STARTED" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM receiving_record").first()).toEqual({
      n: 0,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM cycle_goods_movement WHERE order_id=?")
        .bind(orderId)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("rejects packing before purchase without a success receipt", async () => {
    const { manager, orderId } = await fixture();
    const idempotencyKey = crypto.randomUUID();
    expect(
      await core.advanceAdminFulfillment({
        headers: manager.headers,
        requestId: crypto.randomUUID(),
        locationId,
        orderId,
        action: "COMPLETE_SCHEDULED_PACKING",
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(idempotencyKey)
        .first(),
    ).toBeNull();
  });

  it("rolls back a suppressed per-order packing write and its receipt", async () => {
    const { manager, cycleId, orderId } = await fixture();
    expect(
      await core.completeAdminScheduledWeek({
        headers: manager.headers,
        requestId: crypto.randomUUID(),
        cycleId,
        locationId,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    await env.DB.prepare(
      "CREATE TRIGGER suppress_scheduled_order_pack BEFORE UPDATE OF status ON fulfillment_record BEGIN SELECT RAISE(IGNORE); END",
    ).run();
    const idempotencyKey = crypto.randomUUID();
    try {
      expect(
        await core.advanceAdminFulfillment({
          headers: manager.headers,
          requestId: crypto.randomUUID(),
          locationId,
          orderId,
          action: "COMPLETE_SCHEDULED_PACKING",
          expectedVersion: 1,
          idempotencyKey,
        }),
      ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
      expect(
        await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
      ).toEqual({ status: "COMMITTED" });
      expect(
        await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
          .bind(idempotencyKey)
          .first(),
      ).toBeNull();
    } finally {
      await env.DB.exec("DROP TRIGGER suppress_scheduled_order_pack");
    }
  });
});
