import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import type { RpcResult } from "@freshmarkets/contracts";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import { releaseScheduledSurplus } from "./scheduled-surplus";
import { requestOrderCancellation } from "../../orders/application/cancel-order";
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
async function receivedFixture(cancel = true) {
  const fx = await fixture();
  value(await core.recordScheduledCountedReceipt(fx.request));
  const first = fx.sizes[0];
  if (!first) throw new Error("Missing size");
  const request = {
    ...fx.meta,
    cycleId: fx.id,
    locationId,
    inventoryPoolId: first.poolId,
    quantityBase: 1,
    expectedVersion: 1,
    inspected: true as const,
    reason: "Inspected unused goods after cancellation",
    idempotencyKey: crypto.randomUUID(),
  };
  if (cancel) {
    const paymentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?, ?,500,'PHP','SUCCEEDED',?,1,1)",
      ).bind(paymentId, fx.id, fx.id, paymentId),
      env.DB.prepare("UPDATE payment_attempt SET payment_intent_id=? WHERE id=?").bind(
        paymentId,
        fx.id,
      ),
      env.DB.prepare(
        "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,1)",
      ).bind(paymentId, paymentId, paymentId, fx.id),
      env.DB.prepare(
        "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='orders.manage'",
      ).bind(fx.manager.id),
    ]);
    const staff = await env.DB.prepare("SELECT auth_user_id FROM staff_identity WHERE id=?")
      .bind(fx.manager.id)
      .first<{ auth_user_id: string }>();
    if (!staff) throw new Error("Missing staff");
    const canceled = await requestOrderCancellation(env.DB, {
      orderId: fx.id,
      expectedVersion: 1,
      actor: "BUSINESS",
      cause: "OPERATIONAL_FAILURE",
      actorAuthUserId: staff.auth_user_id,
      reason: "Cannot fulfill this Order",
      idempotencyKey: crypto.randomUUID(),
      requestId: fx.meta.requestId,
    });
    if (!canceled.ok) throw new Error(JSON.stringify(canceled.error));
    expect(canceled.value.state).toBe("CANCELLATION_REQUESTED");
    // The real Order operation released demand. Refund provider acceptance remains separate.
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM committed_demand WHERE order_id=? AND status='OPEN'",
      )
        .bind(fx.id)
        .first(),
    ).toEqual({ count: 0 });
  }
  return { ...fx, request, first, productId: fx.request.productId };
}
async function noRelease(fx: Awaited<ReturnType<typeof receivedFixture>>) {
  expect(
    await env.DB.prepare(
      "SELECT id FROM inventory_ledger_entries WHERE inventory_pool_id=? AND movement_type='SURPLUS_RELEASE'",
    )
      .bind(fx.first.poolId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT surplus_released_base,version FROM cycle_goods_balance WHERE cycle_id=? AND inventory_pool_id=?",
    )
      .bind(fx.id, fx.first.poolId)
      .first(),
  ).toEqual({ surplus_released_base: 0, version: 1 });
  expect(
    await env.DB.prepare(
      "SELECT id FROM cycle_goods_movement WHERE cycle_id=? AND movement_type='SURPLUS_RELEASE'",
    )
      .bind(fx.id)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT on_hand FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
    )
      .bind(locationId, fx.first.poolId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(fx.request.idempotencyKey)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?")
      .bind(fx.request.idempotencyKey)
      .first(),
  ).toBeNull();
}
async function pendingAddition(fx: Awaited<ReturnType<typeof receivedFixture>>) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'ORDER_AMENDMENT','paid_order_amendment',?, ?,100,'PHP','PROCESSING',?,1,1)",
    ).bind(id, id, fx.id, id),
    env.DB.prepare(
      "INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,payment_intent_id,idempotency_key,created_at,updated_at) VALUES (?,?,'PENDING_PAYMENT','PHP',100,?,?,1,1)",
    ).bind(id, fx.id, id, id),
  ]);
}
describe("inspected Scheduled surplus", () => {
  it("releases actually received counts after real cancellation, once, without crediting grams", async () => {
    const fx = await receivedFixture();
    const result = value(await core.releaseScheduledSurplus(fx.request));
    expect(value(await core.releaseScheduledSurplus(fx.request))).toEqual(result);
    expect(await core.releaseScheduledSurplus({ ...fx.request, quantityBase: 2 })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await env.DB.prepare(
        "SELECT on_hand,reserved FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
      )
        .bind(locationId, fx.first.poolId)
        .first(),
    ).toEqual({ on_hand: 1, reserved: 0 });
    expect(
      await env.DB.prepare(
        "SELECT quantity_delta_base,reference_id FROM inventory_ledger_entries WHERE movement_type='SURPLUS_RELEASE' AND inventory_pool_id=?",
      )
        .bind(fx.first.poolId)
        .first(),
    ).toEqual({ quantity_delta_base: 1, reference_id: result.movementId });
    const rows = value(
      await core.listReceivingSessions({ ...fx.meta, locationId, cycleId: fx.id }),
    ).surplus;
    expect(rows).toContainEqual(
      expect.objectContaining({
        inventoryPoolId: fx.first.poolId,
        availableBase: 1,
        releasedBase: 1,
        version: 2,
      }),
    );
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM inventory_balance WHERE inventory_pool_id IN (SELECT inventory_pool_id FROM product WHERE id=?)",
      )
        .bind(fx.productId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("protects outstanding paid demand and rejects uninspected or wrong-scope releases", async () => {
    const fx = await receivedFixture(false);
    expect(await core.releaseScheduledSurplus(fx.request)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(
      await core.releaseScheduledSurplus({ ...fx.request, locationId: "location-cebu-north" }),
    ).toMatchObject({ ok: false });
    expect(
      await releaseScheduledSurplus(
        { db: env.DB, auth: createAuth(env) },
        // @ts-expect-error Deliberately invalid RPC input must be rejected at runtime.
        { ...fx.request, inspected: false },
      ),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    await noRelease(fx);
  });
  it.each(["cycle_goods_movement", "inventory_balance", "inventory_ledger_entries", "audit_event"])(
    "rolls back if %s silently omits its required effect",
    async (table) => {
      const fx = await receivedFixture(),
        trigger = `surplus_ignore_${table}`;
      await env.DB.exec(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.releaseScheduledSurplus(fx.request)).toMatchObject({ ok: false });
        await noRelease(fx);
      } finally {
        await env.DB.exec(`DROP TRIGGER ${trigger}`);
      }
    },
  );
  it("cannot release the same remaining allocation twice concurrently", async () => {
    const fx = await receivedFixture();
    const results = await Promise.all([
      core.releaseScheduledSurplus({ ...fx.request, quantityBase: 2 }),
      core.releaseScheduledSurplus({
        ...fx.request,
        quantityBase: 2,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT on_hand FROM inventory_balance WHERE location_id=? AND inventory_pool_id=?",
      )
        .bind(locationId, fx.first.poolId)
        .first(),
    ).toEqual({ on_hand: 2 });
  });
  it.each(["scope", "demand", "payment"])(
    "rechecks mutable %s inside the same transaction",
    async (kind) => {
      const fx = await receivedFixture();
      let reached = false;
      const db = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              if (kind === "scope")
                await target
                  .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                  .bind(fx.manager.id)
                  .run();
              if (kind === "demand")
                await target
                  .prepare(
                    "UPDATE committed_demand SET status='OPEN',version=version+1 WHERE order_id=?",
                  )
                  .bind(fx.id)
                  .run();
              if (kind === "payment") await pendingAddition(fx);
              return target.batch(statements);
            };
          const property = Reflect.get(target, key);
          return typeof property === "function" ? property.bind(target) : property;
        },
      });
      expect(
        await releaseScheduledSurplus({ db, auth: createAuth(env) }, fx.request),
      ).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      await noRelease(fx);
    },
  );
  it("recovers a lost committed reply using the original result", async () => {
    const fx = await receivedFixture();
    let committed = false;
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.batch(statements);
            committed = true;
            throw new Error("Synthetic lost reply");
          };
        const property = Reflect.get(target, key);
        return typeof property === "function" ? property.bind(target) : property;
      },
    });
    const saved = await releaseScheduledSurplus({ db, auth: createAuth(env) }, fx.request);
    expect(committed).toBe(true);
    expect(saved).toMatchObject({ ok: true });
    expect(await core.releaseScheduledSurplus(fx.request)).toEqual(saved);
  });
});
