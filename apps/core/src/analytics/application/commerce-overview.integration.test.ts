import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { Capability } from "@freshmarkets/contracts";
import { readCommerceOverview } from "./commerce-overview";

let now = Date.parse("2040-10-07T12:00:00+08:00");
beforeEach(() => {
  now += 400 * 86400000;
});
async function customer(at = now - 100 * 86400000) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,created_at,updated_at) VALUES (?,?,?,?)",
  )
    .bind(id, id, at, at)
    .run();
  return id;
}
async function purchase(
  buyer: string,
  at: number,
  options: {
    paid?: boolean;
    amount?: number;
    snapshot?: boolean;
    currency?: string;
    status?: string;
  } = {},
) {
  const id = crypto.randomUUID();
  const currency = options.currency ?? "PHP";
  const amount = options.amount ?? 100;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,?,?,?,?,1,?,?)`,
    ).bind(
      id,
      id,
      buyer,
      amount,
      currency,
      options.status ?? (options.paid === false ? "INITIATED" : "SUCCEEDED"),
      id,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,'SUCCEEDED','canonical',?,?,?)`,
    ).bind(id, buyer, id, amount, currency, id, at, at),
    env.DB.prepare(
      `INSERT INTO grocery_order(id,customer_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at) VALUES (?,?,'INSTANT','{}','COMMITTED',?,?,?,?)`,
    ).bind(id, buyer, amount, currency, id, at),
    ...(options.snapshot === false
      ? []
      : [
          env.DB.prepare(
            `INSERT INTO order_fulfillment_snapshot(order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at) VALUES (?,'location-cebu-central','zone-cebu-city-core','INSTANT','["STOCKED"]',?)`,
          ).bind(id, at),
        ]),
    ...(options.paid === false
      ? []
      : [
          env.DB.prepare(
            "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,?)",
          ).bind(id, id, id, id, at),
          env.DB.prepare(
            `INSERT INTO payment_reaction(id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,created_at,updated_at) VALUES (?,?,'COMMIT_ORDER','checkout_quote',?,'SUCCEEDED',?,?,?)`,
          ).bind(id, id, id, id, at, at),
        ]),
  ]);
  return id;
}
function read(capabilities: Capability[] = ["analytics.read"]) {
  return readCommerceOverview(env.DB, {
    scope: { kind: "GLOBAL" },
    timezone: "Asia/Manila",
    period: "7d",
    capabilities,
    now,
  });
}

describe("Home commerce projection", () => {
  it("keeps zero activity distinct from undefined rates and limits returned dates", async () => {
    const result = await read();
    expect(result.revenue.value).toBe(0);
    expect(result.orders.value).toBe(0);
    expect(result.returningRate.value).toBeNull();
    expect(result.users.value).toBeNull();
    expect(result.series).toHaveLength(8);
    expect(result.products).toEqual([]);
    expect(result.recentOrders).toEqual([]);
  });
  it("uses paid commitments, independent confirmation/refund dates and PHP without erasing refunded purchases", async () => {
    const buyer = await customer();
    await purchase(buyer, now - 10 * 86400000);
    const paid = await purchase(buyer, now - 86400000, { amount: 500, status: "REFUNDED" });
    await purchase(await customer(), now - 2 * 86400000, { amount: 300 });
    await purchase(await customer(), now - 86400000, { paid: false, amount: 900 });
    await purchase(await customer(), now - 86400000, { currency: "USD", amount: 700 });
    await env.DB.prepare(
      `INSERT INTO payment_refund(id,payment_intent_id,amount_minor,currency,status,idempotency_key,created_at,updated_at,succeeded_at) VALUES (?,?,200,'PHP','SUCCEEDED',?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        paid,
        crypto.randomUUID(),
        now - 86400000,
        now - 3600000,
        now - 3600000,
      )
      .run();
    const result = await read(["analytics.read", "orders.read", "payments.read"]);
    expect(result.revenue.value).toBe(800);
    expect(result.refunds.value).toBe(200);
    expect(result.orders.value).toBe(3);
    expect(result.purchasingCustomers.value).toBe(3);
    expect(result.returningRate.value).toBeCloseTo(100 / 3);
    expect(result.series.reduce((sum, row) => sum + (row.receivedMinor ?? 0), 0)).toBe(800);
    expect(result.series.reduce((sum, row) => sum + (row.refundedMinor ?? 0), 0)).toBe(200);
    expect(result.recentOrders).toHaveLength(4);
    expect(result.recentTransactions).toHaveLength(2);
  });
  it("includes committed additions once, keeps option quantities separate and counts Customer registrations", async () => {
    const buyer = await customer(now - 86400000);
    const order = await purchase(buyer, now - 86400000);
    const sku = crypto.randomUUID();
    const amendment = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity) VALUES (?,?,?,'Beans','1 kg','kg',2,100,200,2000)`,
      ).bind(crypto.randomUUID(), order, sku),
      env.DB.prepare(
        `INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,idempotency_key,created_at,updated_at,committed_at) VALUES (?,?,'COMMITTED','PHP',100,?,?,?,?)`,
      ).bind(amendment, order, amendment, now - 3600000, now - 3600000, now - 3600000),
      env.DB.prepare(
        `INSERT INTO paid_order_amendment_line(id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,unit_price_minor,line_total_minor,created_at) VALUES (?,?,?,'Beans','1 kg','kg',1,1000,100,100,?)`,
      ).bind(crypto.randomUUID(), amendment, sku, now - 3600000),
    ]);
    const result = await read(["analytics.read", "customers.read"]);
    expect(result.products).toEqual([
      {
        skuId: sku,
        productName: "Beans",
        variantName: "1 kg",
        unit: "kg",
        quantity: 3,
        grossSalesMinor: 300,
      },
    ]);
    expect(result.users.value).toBeGreaterThan(0);
    expect(result.series.reduce((sum, row) => sum + (row.newUsers ?? 0), 0)).toBe(1);
    expect(result.orders.value).toBe(1);
    expect(result.deniedSections).toEqual(
      expect.arrayContaining(["recentOrders", "recentTransactions"]),
    );
  });
  it("does not invent confirmation dates or location attribution", async () => {
    await purchase(await customer(), now - 86400000, { snapshot: false });
    const scoped = await readCommerceOverview(env.DB, {
      scope: {
        kind: "LOCATION",
        marketId: "market-metro-cebu",
        locationId: "location-cebu-central",
      },
      timezone: "Asia/Manila",
      period: "7d",
      capabilities: ["analytics.read", "customers.read", "orders.read", "payments.read"],
      now,
    });
    expect(scoped.revenue.value).toBeNull();
    expect(scoped.orders.value).toBeNull();
    expect(scoped.series.every((p) => p.receivedMinor === null)).toBe(true);
    expect(scoped.recentOrders).toEqual([]);
    expect(scoped.users.value).toBeNull();
    const unknown = await purchase(await customer(), now - 86400000, {
      paid: false,
      status: "SUCCEEDED",
    });
    const result = await read();
    expect(result.revenue.value).toBeNull();
    expect(result.revenue.unavailableReason).toContain("confirmed date");
    expect(result.recentTransactions.some((p) => p.paymentIntentId === unknown)).toBe(false);
  });
  it("rejects inexact totals and uses local calendar month/year boundaries", async () => {
    await purchase(await customer(), now - 86400000, { amount: Number.MAX_SAFE_INTEGER });
    await purchase(await customer(), now - 86400000);
    const result = await read();
    expect(result.revenue.value).toBeNull();
    expect(result.revenue.unavailableReason).toContain("exact numeric range");
    const midnight = Date.parse("2060-01-01T00:30:00+08:00");
    const buyer = await customer(midnight - 10000);
    await purchase(buyer, midnight - 3600000, { amount: 200 });
    await purchase(buyer, midnight - 1000, { amount: 300 });
    const calendar = await readCommerceOverview(env.DB, {
      scope: { kind: "GLOBAL" },
      timezone: "Asia/Manila",
      period: "7d",
      capabilities: ["analytics.read"],
      now: midnight,
    });
    expect(calendar.revenue.value).toBe(500);
    expect(calendar.monthlyRevenue.value).toBe(300);
    expect(calendar.yearlyRevenue.value).toBe(300);
  });
});
