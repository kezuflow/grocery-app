import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
const core = exports.default;
const locationId = "location-cebu-central";
const pools = [
  { id: "pool-red-onion", sku: "sku-red-onion-500g", quantity: 1000, unit: "GRAM" },
  { id: "pool-eggs", sku: "sku-eggs-6", quantity: 6, unit: "PIECE" },
];
async function fixture() {
  const manager = await locationManager("location"),
    cycleId = crypto.randomUUID();
  await seedTestCycle(env.DB, cycleId);
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('procurement.manage','fulfillment.manage')",
  )
    .bind(manager.id)
    .run();
  const common = { headers: manager.headers, locationId, requestId: crypto.randomUUID() };
  const receipts: string[] = [];
  for (const pool of pools) {
    const id = crypto.randomUUID();
    receipts.push(id);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement(id,delivery_cycle_id,location_id,inventory_pool_id,required_quantity,status,version) VALUES (?,?,?,?,?,'ORDERED',1)",
      ).bind(id, cycleId, locationId, pool.id, pool.quantity),
      env.DB.prepare(
        "INSERT INTO receiving_record(id,procurement_requirement_id,expected_quantity,accepted_quantity,rejected_quantity,status,version) VALUES (?,?,?,0,0,'NOT_STARTED',1)",
      ).bind(id, id, pool.quantity),
    ]);
    expect(
      await core.startAdminReceiving({
        ...common,
        requirementId: id,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
  }
  async function receive(index: number, quantity: number) {
    const id = receipts[index];
    if (!id) throw new Error("Missing receipt fixture");
    expect(
      await core.recordAdminReceivedLine({
        ...common,
        receivingSessionId: id,
        expectedVersion: 2,
        acceptedBase: quantity,
        rejectedBase: 0,
        idempotencyKey: crypto.randomUUID(),
        reason: "Inspected supplier goods",
      }),
    ).toMatchObject({ ok: true });
  }
  async function order() {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
      ).bind(id, id),
      env.DB.prepare(
        "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
      ).bind(id, id, id),
      env.DB.prepare(
        "INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,status,total_minor,currency,created_at) VALUES (?,?,?,'SCHEDULED',?,'{}','COMMITTED',100,'PHP',1)",
      ).bind(id, id, id, cycleId),
      env.DB.prepare(
        "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,?,'NOT_STARTED',1,1)",
      ).bind(id, id, locationId),
    ]);
    for (const pool of pools) {
      const lineId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,?,'Paid item','Pack',?,1,50,50,?,?,1000)",
        ).bind(lineId, id, pool.sku, pool.unit, pool.quantity, pool.unit),
        env.DB.prepare(
          "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES (?,?,?,?,?,?,'OPEN','EXACT_PAID_LINE',?,?,1,?,?,1000,1)",
        ).bind(
          lineId,
          id,
          cycleId,
          locationId,
          pool.id,
          pool.quantity,
          lineId,
          pool.sku,
          pool.quantity,
          pool.unit,
        ),
      ]);
    }
    for (const [index, action] of (
      ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING"] as const
    ).entries())
      expect(
        await core.advanceAdminFulfillment({
          ...common,
          orderId: id,
          action,
          expectedVersion: index + 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
    return {
      ...common,
      orderId: id,
      action: "MARK_PACKED" as const,
      expectedVersion: 4,
      idempotencyKey: crypto.randomUUID(),
    };
  }
  return { cycleId, receive, order };
}
describe("Scheduled receipt to packing commands", () => {
  it("rejects missing goods without consuming another pool and recovers after receipt", async () => {
    const fx = await fixture();
    await fx.receive(0, 1000);
    const request = await fx.order();
    const physicalBefore = (
      await env.DB.prepare(
        "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
      ).all()
    ).results;
    expect(await core.advanceAdminFulfillment(request)).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT status,version FROM fulfillment_record WHERE order_id=?")
        .bind(request.orderId)
        .first(),
    ).toEqual({ status: "PACKING", version: 4 });
    expect(
      await env.DB.prepare("SELECT id FROM cycle_goods_movement WHERE order_id=?")
        .bind(request.orderId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toBeNull();
    await fx.receive(1, 6);
    const packed = await core.advanceAdminFulfillment(request);
    expect(packed).toMatchObject({ ok: true, value: { status: "PACKED", version: 5 } });
    expect(await core.advanceAdminFulfillment(request)).toEqual(packed);
    expect(
      (
        await env.DB.prepare(
          "SELECT received_base,packed_base FROM cycle_goods_balance WHERE cycle_id=? ORDER BY inventory_pool_id",
        )
          .bind(fx.cycleId)
          .all()
      ).results,
    ).toEqual([
      { received_base: 6, packed_base: 6 },
      { received_base: 1000, packed_base: 1000 },
    ]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM cycle_goods_movement WHERE order_id=?")
        .bind(request.orderId)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
        ).all()
      ).results,
    ).toEqual(physicalBefore);
  });
  it("allows only one order to consume the last received allocation across multiple pools", async () => {
    const fx = await fixture();
    await fx.receive(0, 1000);
    await fx.receive(1, 6);
    const a = await fx.order(),
      b = await fx.order();
    const results = await Promise.all([
      core.advanceAdminFulfillment(a),
      core.advanceAdminFulfillment(b),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM cycle_goods_movement WHERE cycle_id=? AND movement_type='PACKING'",
      )
        .bind(fx.cycleId)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?)",
      )
        .bind(a.idempotencyKey, b.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});
