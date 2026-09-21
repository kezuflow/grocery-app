import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";

const core = exports.default;

async function grantProcurementRead(staffId: string) {
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.read'",
  )
    .bind(staffId)
    .run();
}

async function seedLocation(id: string) {
  await env.DB.prepare(
    "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,?,'FULFILLMENT_CENTER',10,123,'active',1,1)",
  )
    .bind(id, id, `Destination ${id}`)
    .run();
}

async function seedOrder(cycleId: string, orderId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(orderId, orderId),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(orderId, orderId, orderId),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
    ).bind(orderId, orderId, orderId, cycleId),
  ]);
}

type PaidLine = {
  cycleId: string;
  orderId: string;
  locationId: string;
  skuId: string;
  poolId: string;
  productName: string;
  variantName: string;
  unitName: string;
  baseUnit: "GRAM" | "PIECE";
  soldUnits: number;
  baseQuantity: number;
  status?: "OPEN" | "CANCELED";
  addition?: boolean;
};

async function seedPaidLine(line: PaidLine) {
  const lineId = crypto.randomUUID();
  if (line.addition) {
    const amendmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,idempotency_key,created_at,updated_at) VALUES (?,?,'COMMITTED','PHP',100,?,1,1)",
      ).bind(amendmentId, line.orderId, amendmentId),
      env.DB.prepare(
        "INSERT INTO paid_order_amendment_line(id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,unit_price_minor,line_total_minor,created_at,base_unit_code_snapshot) VALUES (?,?,?,?,?,?,?,?,100,100,1,?)",
      ).bind(
        lineId,
        amendmentId,
        line.skuId,
        line.productName,
        line.variantName,
        line.unitName,
        line.soldUnits,
        line.baseQuantity,
        line.baseUnit,
      ),
      env.DB.prepare(
        "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,amendment_line_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,committed_at) VALUES (?,?,?,?,?,?,?,'EXACT_PAID_LINE',?,?,?,?,?,1)",
      ).bind(
        crypto.randomUUID(),
        line.orderId,
        line.cycleId,
        line.locationId,
        line.poolId,
        line.baseQuantity,
        line.status ?? "OPEN",
        lineId,
        line.skuId,
        line.soldUnits,
        line.baseQuantity,
        line.baseUnit,
      ),
    ]);
    return;
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      lineId,
      line.orderId,
      line.skuId,
      line.productName,
      line.variantName,
      line.unitName,
      line.soldUnits,
      100,
      100,
      line.baseQuantity,
      line.baseUnit,
    ),
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,committed_at) VALUES (?,?,?,?,?,?,?,'EXACT_PAID_LINE',?,?,?,?,?,1)",
    ).bind(
      crypto.randomUUID(),
      line.orderId,
      line.cycleId,
      line.locationId,
      line.poolId,
      line.baseQuantity,
      line.status ?? "OPEN",
      lineId,
      line.skuId,
      line.soldUnits,
      line.baseQuantity,
      line.baseUnit,
    ),
  ]);
}

async function seedUnpaidAddition(orderId: string) {
  const amendmentId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,idempotency_key,created_at,updated_at) VALUES (?,?,'PENDING_PAYMENT','PHP',100,?,1,1)",
    ).bind(amendmentId, orderId, amendmentId),
    env.DB.prepare(
      "INSERT INTO paid_order_amendment_line(id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,unit_price_minor,line_total_minor,created_at,base_unit_code_snapshot) VALUES (?,?,?,?,?,?,?,?,100,100,1,'PIECE')",
    ).bind(
      crypto.randomUUID(),
      amendmentId,
      "sku-abiu-1pc",
      "Unpaid addition",
      "Must stay hidden",
      "PIECE",
      99,
      99,
    ),
  ]);
}

describe("Scheduled cycle order summary", () => {
  it("aggregates paid originals and additions, excludes cancellations, and enforces scope", async () => {
    const cycleId = crypto.randomUUID();
    const secondLocation = `destination-${cycleId}`;
    await seedTestCycle(env.DB, cycleId);
    await seedLocation(secondLocation);
    const local = await locationManager("location");
    const global = await locationManager("global");
    await grantProcurementRead(local.id);
    await grantProcurementRead(global.id);
    await seedOrder(cycleId, `order-a-${cycleId}`);
    await seedOrder(cycleId, `order-b-${cycleId}`);
    await seedUnpaidAddition(`order-a-${cycleId}`);
    const common = { cycleId, status: "OPEN" as const };
    await seedPaidLine({
      ...common,
      orderId: `order-a-${cycleId}`,
      locationId: "location-cebu-central",
      skuId: "sku-abiu-1pc",
      poolId: "pool-abiu",
      productName: "Abiu",
      variantName: "1 piece",
      unitName: "PIECE",
      baseUnit: "PIECE",
      soldUnits: 6,
      baseQuantity: 6,
    });
    await seedPaidLine({
      ...common,
      orderId: `order-a-${cycleId}`,
      locationId: "location-cebu-central",
      skuId: "sku-abiu-1pc",
      poolId: "pool-abiu",
      productName: "Abiu",
      variantName: "1 piece",
      unitName: "PIECE",
      baseUnit: "PIECE",
      soldUnits: 4,
      baseQuantity: 4,
      addition: true,
    });
    await seedPaidLine({
      ...common,
      orderId: `order-b-${cycleId}`,
      locationId: secondLocation,
      skuId: "sku-abiu-1pc",
      poolId: "pool-carrot",
      productName: "Abiu",
      variantName: "Historical weighed option",
      unitName: "GRAM",
      baseUnit: "GRAM",
      soldUnits: 1,
      baseQuantity: 1000,
    });
    await seedPaidLine({
      ...common,
      orderId: `order-a-${cycleId}`,
      locationId: "location-cebu-central",
      skuId: "sku-carrot-1kg",
      poolId: "pool-carrot",
      productName: "Carrots",
      variantName: "1 kg",
      unitName: "GRAM",
      baseUnit: "GRAM",
      soldUnits: 10,
      baseQuantity: 10000,
    });
    await seedPaidLine({
      ...common,
      orderId: `order-b-${cycleId}`,
      locationId: secondLocation,
      skuId: "sku-carrot-1kg",
      poolId: "pool-carrot",
      productName: "Carrots",
      variantName: "1 kg",
      unitName: "GRAM",
      baseUnit: "GRAM",
      soldUnits: 2,
      baseQuantity: 2000,
    });
    await seedPaidLine({
      ...common,
      orderId: `order-a-${cycleId}`,
      locationId: "location-cebu-central",
      skuId: "sku-cucumber-1kg",
      poolId: "pool-cucumber",
      productName: "Cucumber",
      variantName: "1 kg",
      unitName: "GRAM",
      baseUnit: "GRAM",
      soldUnits: 30,
      baseQuantity: 30000,
    });
    await seedPaidLine({
      ...common,
      status: "CANCELED",
      orderId: `order-b-${cycleId}`,
      locationId: secondLocation,
      skuId: "sku-cucumber-1kg",
      poolId: "pool-cucumber",
      productName: "Cucumber",
      variantName: "1 kg",
      unitName: "GRAM",
      baseUnit: "GRAM",
      soldUnits: 5,
      baseQuantity: 5000,
    });

    const globalResult = await core.getAdminScheduledWeek({
      headers: global.headers,
      requestId: crypto.randomUUID(),
      cycleId,
      section: "ORDER_SUMMARY",
    });
    if (!globalResult.ok || globalResult.value.page.kind !== "ORDER_SUMMARY")
      throw new Error("Missing global summary");
    expect(globalResult.value.page.totals).toEqual({
      paidOrderCount: 2,
      productCount: 3,
      sellingOptionCount: 3,
      destinationCount: 2,
    });
    expect(
      globalResult.value.page.items.map((item) => [
        item.productName,
        item.paidOrderCount,
        item.soldUnitCount,
        item.totalQuantityBase,
        item.destinationCount,
      ]),
    ).toEqual([
      ["Abiu", 1, 10, 10, 1],
      ["Abiu", 1, 1, 1000, 1],
      ["Carrots", 2, 12, 12000, 2],
      ["Cucumber", 1, 30, 30000, 1],
    ]);

    const localResult = await core.getAdminScheduledWeek({
      headers: local.headers,
      requestId: crypto.randomUUID(),
      locationId: "location-cebu-central",
      cycleId,
      section: "ORDER_SUMMARY",
    });
    if (!localResult.ok || localResult.value.page.kind !== "ORDER_SUMMARY")
      throw new Error("Missing local summary");
    expect(localResult.value.page.totals).toEqual({
      paidOrderCount: 1,
      productCount: 3,
      sellingOptionCount: 3,
      destinationCount: 1,
    });
    expect(
      localResult.value.page.items.find((item) => item.productName === "Carrots")
        ?.totalQuantityBase,
    ).toBe(10000);
    expect(
      await core.getAdminScheduledWeek({
        headers: local.headers,
        requestId: crypto.randomUUID(),
        cycleId,
        section: "ORDER_SUMMARY",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("keeps labels, options, pools and units distinct and totals stable across pages", async () => {
    const cycleId = crypto.randomUUID();
    await seedTestCycle(env.DB, cycleId);
    const global = await locationManager("global");
    await grantProcurementRead(global.id);
    const orderId = `order-${cycleId}`;
    await seedOrder(cycleId, orderId);
    for (let index = 0; index < 51; index++) {
      const skuId = `summary-sku-${String(index).padStart(2, "0")}-${cycleId}`;
      await env.DB.prepare(
        "INSERT INTO sku(id,product_id,code,name,sellable_unit_id,sell_quantity,consumption_base_quantity,status,sort_order,version,created_at,updated_at) SELECT ?,product_id,?,?,sellable_unit_id,sell_quantity,consumption_base_quantity,status,sort_order,version,created_at,updated_at FROM sku WHERE id='sku-carrot-1kg'",
      )
        .bind(skuId, skuId, `Summary option ${index}`)
        .run();
      await seedPaidLine({
        cycleId,
        orderId,
        locationId: "location-cebu-central",
        skuId,
        poolId: "pool-carrot",
        productName: index === 50 ? "Historic carrots" : "Carrots",
        variantName: `${index + 1} kg`,
        unitName: "GRAM",
        baseUnit: "GRAM",
        soldUnits: 1,
        baseQuantity: 1000,
      });
    }
    const query = {
      headers: global.headers,
      requestId: crypto.randomUUID(),
      cycleId,
      section: "ORDER_SUMMARY" as const,
    };
    const first = await core.getAdminScheduledWeek(query);
    if (!first.ok || first.value.page.kind !== "ORDER_SUMMARY" || !first.value.page.nextCursor)
      throw new Error("Missing first summary page");
    expect(first.value.page.items).toHaveLength(50);
    expect(first.value.page.totals).toEqual({
      paidOrderCount: 1,
      productCount: 1,
      sellingOptionCount: 51,
      destinationCount: 1,
    });
    const second = await core.getAdminScheduledWeek({
      ...query,
      cursor: first.value.page.nextCursor,
    });
    if (!second.ok || second.value.page.kind !== "ORDER_SUMMARY")
      throw new Error("Missing second summary page");
    expect(second.value.page.items).toHaveLength(1);
    expect(second.value.page.nextCursor).toBeNull();
    expect(second.value.page.totals).toEqual(first.value.page.totals);
    expect(
      new Set([...first.value.page.items, ...second.value.page.items].map((item) => item.skuId))
        .size,
    ).toBe(51);
  });
});
