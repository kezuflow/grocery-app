import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { RpcResult } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { recordScheduledCountedReceipt } from "./scheduled-counted-receipts";
const core = exports.default,
  locationId = "location-cebu-central";
function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.manage','catalog.read','procurement.manage','procurement.read','fulfillment.manage')",
  )
    .bind(manager.id)
    .run();
  const meta = { headers: manager.headers, requestId: crypto.randomUUID() },
    id = crypto.randomUUID();
  const product = value(
    await core.createAdminProduct({
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      categoryId: "category-vegetables",
      name: `Scheduled broccoli ${id}`,
      slug: `scheduled-broccoli-${id}`,
      description: null,
      inventoryBaseUnitId: "unit-gram",
      stockTracking: "COUNTED_SIZES",
      customerDetails: [],
    }),
  );
  const sizes = [];
  for (const [name, quantity, grams] of [
    ["Small", 2, 300],
    ["Large", 3, 700],
  ] as const) {
    const sku = value(
      await core.createAdminSku({
        ...meta,
        idempotencyKey: crypto.randomUUID(),
        productId: product.productId,
        code: `${name}-${id}`,
        name,
        sellableUnitId: "unit-piece",
        sellQuantity: 1,
        consumptionBaseQuantity: 1,
        estimatedShippingWeightGrams: grams,
        merchandisingLabel: "Pack",
      }),
    );
    if (!sku.stockPoolId) throw new Error("Missing counted pool");
    sizes.push({ skuId: sku.skuId, poolId: sku.stockPoolId, quantity, grams, name });
  }
  await seedTestCycle(env.DB, id);
  // Synthetic committed history is a fixture seam; authoring, purchase, receiving and packing are real commands.
  await env.DB.batch([
    env.DB.prepare("UPDATE delivery_cycle SET cutoff_at=? WHERE id=?").bind(Date.now() - 1000, id),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,500,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(id, id, id),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,fulfillment_mode,cycle_id,address_snapshot_json,status,total_minor,currency,created_at) VALUES (?,?,?,'SCHEDULED',?,'{}','COMMITTED',500,'PHP',1)",
    ).bind(id, id, id, id),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,?,'NOT_STARTED',1,1)",
    ).bind(id, id, locationId),
  ]);
  const lines = [];
  for (const size of sizes) {
    const lineId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,?,'Broccoli',?,'PIECE',?,100,?,?,'PIECE',?)",
      ).bind(
        lineId,
        id,
        size.skuId,
        size.name,
        size.quantity,
        size.quantity * 100,
        size.quantity,
        size.quantity * size.grams,
      ),
      env.DB.prepare(
        "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES (?,?,?,?,?,?,'OPEN','EXACT_PAID_LINE',?,?,?,?,'PIECE',?,1)",
      ).bind(
        lineId,
        id,
        id,
        locationId,
        size.poolId,
        size.quantity,
        lineId,
        size.skuId,
        size.quantity,
        size.quantity,
        size.quantity * size.grams,
      ),
    ]);
    const purchased = value(
      await core.confirmAdminProcurementPurchase({
        ...meta,
        locationId,
        cycleId: id,
        inventoryPoolId: size.poolId,
        skuId: size.skuId,
        expectedVersion: 0,
        expectedQuantityBase: size.quantity,
        expectedQuantitySellable: size.quantity,
        reason: "Manual supplier purchase",
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const receipt = await env.DB.prepare(
      "SELECT id FROM receiving_record WHERE procurement_requirement_id=?",
    )
      .bind(purchased.requirementId)
      .first<{ id: string }>();
    if (!receipt) throw new Error("Missing purchased receipt");
    lines.push({
      receivingSessionId: receipt.id,
      expectedVersion: 1,
      acceptedBase: size.quantity,
      rejectedBase: 0,
      shortageBase: 0,
    });
  }
  return {
    manager,
    id,
    sizes,
    meta,
    request: {
      ...meta,
      locationId,
      cycleId: id,
      productId: product.productId,
      receivedWeightGrams: 3500,
      receiptKind: "DELIVERY" as const,
      reason: "Actual weighed and counted goods",
      idempotencyKey: crypto.randomUUID(),
      lines,
    },
  };
}
async function noEffects(fx: Awaited<ReturnType<typeof fixture>>) {
  expect(
    await env.DB.prepare("SELECT id FROM scheduled_counted_receipt WHERE cycle_id=?")
      .bind(fx.id)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM cycle_goods_movement WHERE cycle_id=?")
      .bind(fx.id)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(fx.request.idempotencyKey)
      .first(),
  ).toBeNull();
  const rows = await env.DB.prepare(
    "SELECT rr.accepted_quantity,rr.status,rr.version FROM receiving_record rr JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id WHERE pr.delivery_cycle_id=?",
  )
    .bind(fx.id)
    .all();
  expect(rows.results).toEqual([
    { accepted_quantity: 0, status: "NOT_STARTED", version: 1 },
    { accepted_quantity: 0, status: "NOT_STARTED", version: 1 },
  ]);
}
describe("weighed Scheduled size receipt", () => {
  it("records actual counts once and makes only those cycle goods packable", async () => {
    const fx = await fixture();
    const physical = (
      await env.DB.prepare(
        "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
      ).all()
    ).results;
    const received = value(await core.recordScheduledCountedReceipt(fx.request));
    expect(received.receivedWeightGrams).toBe(3500);
    expect(received.lines.map((line) => line.acceptedBase)).toEqual([2, 3]);
    expect(value(await core.recordScheduledCountedReceipt(fx.request))).toEqual(received);
    expect(
      await core.recordScheduledCountedReceipt({ ...fx.request, receivedWeightGrams: 3400 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    for (const [index, action] of (
      ["START_PICKING", "MARK_READY_TO_PACK", "START_PACKING", "MARK_PACKED"] as const
    ).entries())
      expect(
        await core.advanceAdminFulfillment({
          ...fx.meta,
          locationId,
          orderId: fx.id,
          action,
          expectedVersion: index + 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: true });
    for (const size of fx.sizes)
      expect(
        await env.DB.prepare(
          "SELECT received_base,packed_base FROM cycle_goods_balance WHERE cycle_id=? AND inventory_pool_id=?",
        )
          .bind(fx.id, size.poolId)
          .first(),
      ).toEqual({ received_base: size.quantity, packed_base: size.quantity });
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
        ).all()
      ).results,
    ).toEqual(physical);
    expect(
      value(await core.listReceivingSessions({ ...fx.meta, locationId, cycleId: fx.id }))
        .countedReceipts,
    ).toMatchObject([
      { receiptId: received.receiptId, receivedWeightGrams: 3500, lines: expect.any(Array) },
    ]);
    await expect(
      env.DB.prepare("UPDATE scheduled_counted_receipt SET received_weight_grams=1 WHERE id=?")
        .bind(received.receiptId)
        .run(),
    ).rejects.toThrow("IMMUTABLE_COUNTED_RECEIPT");
  });
  it("keeps the original missing count when a separately weighed replacement arrives", async () => {
    const fx = await fixture();
    const original = fx.request.lines[0];
    if (!original) throw new Error("Missing size");
    value(
      await core.recordScheduledCountedReceipt({
        ...fx.request,
        receivedWeightGrams: 2900,
        lines: fx.request.lines.map((line, index) =>
          index === 0 ? { ...line, acceptedBase: 1, shortageBase: 1 } : line,
        ),
      }),
    );
    const replacement = value(
      await core.recordScheduledCountedReceipt({
        ...fx.request,
        receiptKind: "REPLACEMENT",
        receivedWeightGrams: 520,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ ...original, expectedVersion: 2, acceptedBase: 1, shortageBase: 0 }],
      }),
    );
    expect(replacement.receivedWeightGrams).toBe(520);
    expect(
      await env.DB.prepare(
        "SELECT accepted_quantity,shortage_base,replacement_base FROM receiving_record WHERE id=?",
      )
        .bind(original.receivingSessionId)
        .first(),
    ).toEqual({ accepted_quantity: 2, shortage_base: 1, replacement_base: 1 });
  });
  it.each(["scheduled_counted_receipt", "scheduled_counted_receipt_line", "cycle_goods_movement"])(
    "rolls back the whole group if %s is omitted",
    async (table) => {
      const fx = await fixture(),
        trigger = `ignore_group_${table}`;
      await env.DB.exec(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.recordScheduledCountedReceipt(fx.request)).toMatchObject({ ok: false });
        await noEffects(fx);
      } finally {
        await env.DB.exec(`DROP TRIGGER ${trigger}`);
      }
    },
  );
  it("rechecks scope inside the complete group transaction", async () => {
    const fx = await fixture();
    let reached = false;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            reached = true;
            await target
              .prepare("DELETE FROM staff_scope WHERE staff_id=?")
              .bind(fx.manager.id)
              .run();
            return target.batch(statements);
          };
        const property = Reflect.get(target, key);
        return typeof property === "function" ? property.bind(target) : property;
      },
    });
    expect(
      await recordScheduledCountedReceipt({ db, auth: createAuth(env) }, fx.request),
    ).toMatchObject({ ok: false });
    expect(reached).toBe(true);
    await noEffects(fx);
  });
  it("recovers a lost committed reply and cannot double-receive competing groups", async () => {
    const fx = await fixture();
    let committed = false;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.batch(statements);
            committed = true;
            throw new Error("Synthetic lost group reply");
          };
        const property = Reflect.get(target, key);
        return typeof property === "function" ? property.bind(target) : property;
      },
    });
    const saved = await recordScheduledCountedReceipt({ db, auth: createAuth(env) }, fx.request);
    expect(committed).toBe(true);
    expect(saved).toMatchObject({ ok: true });
    expect(await core.recordScheduledCountedReceipt(fx.request)).toEqual(saved);
    const second = await fixture();
    const results = await Promise.all([
      core.recordScheduledCountedReceipt(second.request),
      core.recordScheduledCountedReceipt({
        ...second.request,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
  it("rejects weight-only, wrong-product and direct unweighed counted receipt commands", async () => {
    const fx = await fixture();
    expect(
      await core.recordScheduledCountedReceipt({ ...fx.request, receivedWeightGrams: 0 }),
    ).toMatchObject({ ok: false });
    expect(
      await core.recordScheduledCountedReceipt({ ...fx.request, productId: "another-product" }),
    ).toMatchObject({ ok: false });
    const line = fx.request.lines[0];
    if (!line) throw new Error("Missing line");
    expect(
      await core.recordAdminReceivedLine({
        ...fx.meta,
        locationId,
        ...line,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await noEffects(fx);
  });
});
