import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";

const core = exports.default;

async function fixture() {
  const manager = await locationManager("location");
  const cycleId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  await seedTestCycle(env.DB, cycleId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('procurement.manage','fulfillment.manage','procurement.read')",
    ).bind(manager.id),
    env.DB.prepare("UPDATE delivery_cycle SET cutoff_at=? WHERE id=?").bind(
      Date.now() - 2 * 60 * 60_000,
      cycleId,
    ),
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
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,committed_at) VALUES (?,?,?,'location-cebu-central','pool-red-onion',500,'OPEN','EXACT_PAID_LINE',?,'sku-red-onion-500g',1,500,'GRAM',1)",
    ).bind(orderId, orderId, cycleId, orderId),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,'location-cebu-central','PACKING',1,1)",
    ).bind(orderId, orderId),
  ]);
  const base = {
    headers: manager.headers,
    requestId: crypto.randomUUID(),
    cycleId,
    locationId: "location-cebu-central",
  };
  return { base, cycleId, orderId };
}

describe("temporary Scheduled week completion", () => {
  it("records one purchase and packs the paid week without inventing receipts or stock", async () => {
    const { base, orderId, cycleId } = await fixture();
    const purchase = {
      ...base,
      action: "PURCHASE_COMPLETE" as const,
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await core.completeAdminScheduledWeek(purchase);
    expect(first).toMatchObject({
      ok: true,
      value: { paidOrderCount: 1, version: 1, packedAt: null },
    });
    expect(await core.completeAdminScheduledWeek(purchase)).toEqual(first);
    const pack = {
      ...base,
      action: "FINISH_PACKING" as const,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    };
    const packed = await core.completeAdminScheduledWeek(pack);
    expect(packed).toMatchObject({ ok: true, value: { paidOrderCount: 1, version: 2 } });
    expect(await core.completeAdminScheduledWeek(pack)).toEqual(packed);
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "FULFILLMENT_READY" });
    expect(
      await env.DB.prepare("SELECT status FROM fulfillment_record WHERE order_id=?")
        .bind(orderId)
        .first(),
    ).toEqual({ status: "PACKED" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM receiving_record").first()).toEqual({
      n: 0,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM cycle_goods_balance WHERE cycle_id=?")
        .bind(cycleId)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("rejects changed demand without partial packing or a success receipt", async () => {
    const { base, orderId, cycleId } = await fixture();
    expect(
      await core.completeAdminScheduledWeek({
        ...base,
        action: "PURCHASE_COMPLETE",
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    await env.DB.prepare("UPDATE committed_demand SET status='CANCELED' WHERE order_id=?")
      .bind(orderId)
      .run();
    const key = crypto.randomUUID();
    expect(
      await core.completeAdminScheduledWeek({
        ...base,
        action: "FINISH_PACKING",
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare("SELECT packed_at FROM scheduled_week_completion WHERE cycle_id=?")
        .bind(cycleId)
        .first(),
    ).toEqual({ packed_at: null });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(key)
        .first(),
    ).toBeNull();
  });

  it("rolls back every Order and the week receipt if a packing update is suppressed", async () => {
    const { base, cycleId, orderId } = await fixture();
    expect(
      await core.completeAdminScheduledWeek({
        ...base,
        action: "PURCHASE_COMPLETE",
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    await env.DB.prepare(
      "CREATE TRIGGER suppress_week_pack BEFORE UPDATE OF status ON fulfillment_record BEGIN SELECT RAISE(IGNORE); END",
    ).run();
    const key = crypto.randomUUID();
    expect(
      await core.completeAdminScheduledWeek({
        ...base,
        action: "FINISH_PACKING",
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    expect(
      await env.DB.prepare("SELECT status FROM grocery_order WHERE id=?").bind(orderId).first(),
    ).toEqual({ status: "COMMITTED" });
    expect(
      await env.DB.prepare("SELECT packed_at FROM scheduled_week_completion WHERE cycle_id=?")
        .bind(cycleId)
        .first(),
    ).toEqual({ packed_at: null });
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(key)
        .first(),
    ).toBeNull();
  });
});
