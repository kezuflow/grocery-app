import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { AnalyticsDimension, Scope } from "@freshmarkets/contracts";
import { resolveMetricDefinition } from "../metric-definitions";
import { executeMetricQuery } from "./metric-queries";
import { listReportProducts } from "./report-products";

let start = Date.parse("2026-09-01T00:00:00+08:00");
let end = start + 30 * 86_400_000;
let window = {
  startAt: new Date(start).toISOString(),
  endAt: new Date(end).toISOString(),
  timezone: "Asia/Manila",
};

beforeEach(() => {
  // The Worker suite retains rows within a file. Separate reporting periods
  // exercise isolation without deleting commercial or payment evidence.
  start += 40 * 86_400_000;
  end = start + 30 * 86_400_000;
  window = {
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    timezone: "Asia/Manila",
  };
});

async function customer() {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,created_at,updated_at) VALUES (?,?,?,?)",
  )
    .bind(id, id, start, start)
    .run();
  return id;
}

async function purchase(
  customerId: string,
  at: number,
  options: {
    location?: string;
    status?: string;
    paid?: boolean;
    snapshot?: boolean;
  } = {},
) {
  const id = crypto.randomUUID();
  const status = options.status ?? (options.paid === false ? "INITIATED" : "SUCCEEDED");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_intent
      (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at)
      VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP',?,?,1,?,?)`).bind(
      id,
      id,
      customerId,
      status,
      id,
      at,
      at,
    ),
    env.DB.prepare(`INSERT INTO payment_attempt
      (id,customer_id,payment_intent_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,100,'PHP',?,'canonical',?,?,?)`).bind(id, customerId, id, status, id, at, at),
    env.DB.prepare(`INSERT INTO grocery_order
      (id,customer_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,created_at)
      VALUES (?,?,'INSTANT','{}',?,100,'PHP',?,?)`).bind(
      id,
      customerId,
      status === "REFUNDED" ? "CANCELED" : "COMMITTED",
      id,
      at,
    ),
    ...(options.snapshot === false
      ? []
      : [
          env.DB.prepare(`INSERT INTO order_fulfillment_snapshot
      (order_id,location_id,zone_id,fulfillment_mode,sourcing_modes_json,created_at)
      VALUES (?,?,'zone-cebu-city-core','INSTANT','["STOCKED"]',?)`).bind(
            id,
            options.location ?? "location-cebu-central",
            at,
          ),
        ]),
    ...(options.paid === false
      ? []
      : [
          env.DB.prepare(`INSERT INTO order_payment_reaction
      (id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,?)`).bind(
            id,
            id,
            id,
            id,
            at,
          ),
        ]),
  ]);
  if (options.paid !== false)
    await env.DB.prepare(`INSERT INTO payment_reaction
      (id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,created_at,updated_at)
      VALUES (?,?,'COMMIT_ORDER','checkout_quote',?,'SUCCEEDED',?,?,?)`)
      .bind(id, id, id, id, at, at)
      .run();
  return id;
}

async function value(
  code: string,
  scope: Scope = { kind: "global" },
  dimensions: AnalyticsDimension[] = [],
) {
  const resolved = await resolveMetricDefinition(env.DB, code);
  expect(resolved.queryKey).not.toBeNull();
  const result = await executeMetricQuery({
    database: env.DB,
    queryKey: resolved.queryKey!,
    definition: resolved.definition,
    window,
    scope,
    dimensions,
    computedAt: end,
  });
  expect(result.availability).toBe("AVAILABLE");
  return result.points[0]?.value;
}

describe("Approved purchase reports", () => {
  it("retains historic membership money in Global totals without attributing it to a location", async () => {
    const buyer = await customer();
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO payment_intent
        (id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at)
        VALUES (?,'MEMBERSHIP_ENROLLMENT','subscription',?,?,70,'PHP','PARTIALLY_REFUNDED',?,1,?,?)`).bind(
        id,
        id,
        buyer,
        id,
        start,
        start + 1,
      ),
      env.DB.prepare(`INSERT INTO payment_reaction
        (id,payment_intent_id,reaction_type,subject_type,subject_id,status,idempotency_key,created_at,updated_at)
        VALUES (?,?,'ACTIVATE_MEMBERSHIP','subscription',?,'SUCCEEDED',?,?,?)`).bind(
        id,
        id,
        id,
        id,
        start,
        start,
      ),
      env.DB.prepare(`INSERT INTO payment_refund
        (id,payment_intent_id,amount_minor,currency,status,idempotency_key,created_at,updated_at,succeeded_at)
        VALUES (?,?,20,'PHP','SUCCEEDED',?,?,?,?)`).bind(id, id, id, start, start + 1, start + 1),
    ]);
    const dimensions: AnalyticsDimension[] = [{ key: "currency", value: "PHP" }];
    expect(await value("received_amount", { kind: "global" }, dimensions)).toBe(70);
    expect(await value("refund_amount", { kind: "global" }, dimensions)).toBe(20);
    expect(
      await value(
        "received_amount",
        { kind: "location", locationId: "location-cebu-central" },
        dimensions,
      ),
    ).toBe(0);
    expect(
      await value(
        "refund_amount",
        { kind: "location", locationId: "location-cebu-central" },
        dimensions,
      ),
    ).toBe(0);
  });
  it("does not round financial totals beyond the exact integer range", async () => {
    const order = await purchase(await customer(), start);
    await purchase(await customer(), start + 1);
    await env.DB.prepare("UPDATE payment_intent SET amount_minor=? WHERE id=?")
      .bind(Number.MAX_SAFE_INTEGER, order)
      .run();
    const definition = await resolveMetricDefinition(env.DB, "received_amount");
    expect(
      await executeMetricQuery({
        database: env.DB,
        queryKey: definition.queryKey!,
        definition: definition.definition,
        window,
        scope: { kind: "global" },
        dimensions: [{ key: "currency", value: "PHP" }],
        computedAt: end,
      }),
    ).toMatchObject({ availability: "UNAVAILABLE", points: [] });
  });
  it("retains global paid facts while refusing to guess missing location attribution", async () => {
    await purchase(await customer(), start, { snapshot: false });
    expect(await value("order_count")).toBe(1);
    const definition = await resolveMetricDefinition(env.DB, "order_count");
    expect(
      await executeMetricQuery({
        database: env.DB,
        queryKey: definition.queryKey!,
        definition: definition.definition,
        window,
        scope: { kind: "location", locationId: "location-cebu-central" },
        dimensions: [],
        computedAt: end,
      }),
    ).toMatchObject({ availability: "UNAVAILABLE", points: [] });
  });
  it("counts additions once by their own commitment date and cancellations separately", async () => {
    const location = crypto.randomUUID();
    const orderId = await purchase(await customer(), start - 1, { location });
    const scope: Scope = { kind: "location", locationId: location };
    const skuId = crypto.randomUUID();
    const amendmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO order_item
        (id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity)
        VALUES (?,?,?,'Report onions','500 g','GRAM',2,50,100,1000)`).bind(
        crypto.randomUUID(),
        orderId,
        skuId,
      ),
      env.DB.prepare(`INSERT INTO paid_order_amendment
        (id,order_id,status,currency,total_minor,idempotency_key,created_at,updated_at,committed_at)
        VALUES (?,?,'COMMITTED','PHP',150,?,?,?,?)`).bind(
        amendmentId,
        orderId,
        amendmentId,
        start,
        end + 1,
        start + 1,
      ),
      env.DB.prepare(`INSERT INTO paid_order_amendment_line
        (id,amendment_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,base_quantity,unit_price_minor,line_total_minor,created_at)
        VALUES (?,?,?,'Report onions','500 g','GRAM',3,1500,50,150,?)`).bind(
        crypto.randomUUID(),
        amendmentId,
        skuId,
        start,
      ),
    ]);
    const dimensions: AnalyticsDimension[] = [{ key: "skuId", value: skuId }];
    expect(await value("paid_product_quantity", scope, dimensions)).toBe(3);
    expect(await value("order_count", scope)).toBe(0);
    expect(await value("canceled_product_quantity", scope, dimensions)).toBe(0);
    await env.DB.batch([
      env.DB.prepare("UPDATE grocery_order SET status='CANCELED' WHERE id=?").bind(orderId),
      env.DB.prepare(`INSERT INTO order_cancellation
        (id,order_id,actor_type,cause,reason,status,retained_service_fee_minor,required_refund_minor,currency,version,created_at,updated_at)
        VALUES (?,?,'CUSTOMER','CUSTOMER_REQUEST','Test cancellation','COMPLETED',0,250,'PHP',1,?,?)`).bind(
        crypto.randomUUID(),
        orderId,
        start,
        start + 2,
      ),
    ]);
    expect(await value("canceled_product_quantity", scope, dimensions)).toBe(5);
    expect(await value("paid_product_quantity", scope, dimensions)).toBe(3);
    expect(await value("canceled_orders", scope)).toBe(1);
    expect(await listReportProducts(env.DB, scope, { search: "onions" })).toMatchObject({
      items: [{ skuId, productName: "Report onions", optionName: "500 g" }],
      nextCursor: null,
    });
    expect(
      await listReportProducts(env.DB, { kind: "location", locationId: "other" }, {}),
    ).toMatchObject({ items: [] });
    await expect(listReportProducts(env.DB, scope, { cursor: "invalid" })).rejects.toThrow(
      "cursor",
    );
  });

  it("uses delivery completion dates and compares charges with recorded costs for the same Orders", async () => {
    const orderId = await purchase(await customer(), start);
    const jobId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE grocery_order SET status='DELIVERED',delivery_subtotal_minor=30,delivery_discount_minor=5 WHERE id=?",
      ).bind(orderId),
      env.DB.prepare(`INSERT INTO delivery_job
        (id,order_id,fulfillment_mode,location_id,zone_id,status,address_snapshot_json,delivered_at,created_at,updated_at)
        VALUES (?,?,'INSTANT','location-cebu-central','zone-cebu-city-core','DELIVERED','{}',?,?,?)`).bind(
        jobId,
        orderId,
        start + 2,
        start,
        end + 1,
      ),
    ]);
    expect(await value("delivered_orders")).toBe(1);
    const currency: AnalyticsDimension[] = [{ key: "currency", value: "PHP" }];
    expect(await value("delivery_charges", { kind: "global" }, currency)).toBe(25);
    const definition = await resolveMetricDefinition(env.DB, "delivery_costs");
    expect(
      await executeMetricQuery({
        database: env.DB,
        queryKey: definition.queryKey!,
        definition: definition.definition,
        window,
        scope: { kind: "global" },
        dimensions: currency,
        computedAt: end,
      }),
    ).toMatchObject({ availability: "UNAVAILABLE", points: [] });
    await env.DB.prepare(`INSERT INTO delivery_provider_dispatch
      (id,delivery_job_id,provider,merchant_order_id,provider_delivery_id,request_hash,request_snapshot_json,status,final_payable_minor,customer_delivery_charge_minor,courier_variance_minor,delivery_currency,created_at,updated_at)
      VALUES (?,?,'lalamove',?,?,?,'{}','COMPLETED',40,25,15,'PHP',?,?)`)
      .bind(
        crypto.randomUUID(),
        jobId,
        orderId,
        crypto.randomUUID(),
        "report-test",
        start,
        start + 2,
      )
      .run();
    expect(await value("delivery_costs", { kind: "global" }, currency)).toBe(40);
  });

  it("counts only immutable committed promotion uses and allocations", async () => {
    const buyer = await customer();
    const orderId = await purchase(buyer, start);
    const promotion = crypto.randomUUID();
    const redemption = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO promotion
        (id,code,name,status,benefit_type,discount_minor,starts_at,created_at,updated_at)
        VALUES (?,?,'Report discount','INACTIVE','ORDER_FIXED_DISCOUNT',20,?,?,?)`).bind(
        promotion,
        promotion,
        start,
        start,
        start,
      ),
      env.DB.prepare(`INSERT INTO promotion_grant
        (id,benefit_code,benefit_type,status,parameters_json,created_at,updated_at)
        VALUES (?,?,'ORDER_FIXED_DISCOUNT','EXHAUSTED','{}',?,?)`).bind(
        promotion,
        promotion,
        start,
        start,
      ),
      env.DB.prepare(`INSERT INTO promotion_redemption
        (id,grant_id,benefit_code,benefit_type,customer_id,redeemed_at)
        VALUES (?,?,?,'ORDER_FIXED_DISCOUNT',?,?)`).bind(
        redemption,
        promotion,
        promotion,
        buyer,
        start,
      ),
      env.DB.prepare(`INSERT INTO order_promotion_application
        (id,order_id,promotion_id,redemption_id,price_component,benefit_type,amount_minor,benefit_snapshot_json,created_at)
        VALUES (?,?,?,?,'MERCHANDISE','ORDER_FIXED_DISCOUNT',20,'{}',?)`).bind(
        crypto.randomUUID(),
        orderId,
        promotion,
        redemption,
        start,
      ),
    ]);
    expect(
      await value("promotion_redemptions", { kind: "global" }, [
        { key: "promotionId", value: promotion },
      ]),
    ).toBe(1);
    expect(
      await value("discount_spend", { kind: "global" }, [
        { key: "promotionId", value: promotion },
        { key: "currency", value: "PHP" },
      ]),
    ).toBe(20);
    expect(
      await value("promotion_redemptions", { kind: "global" }, [
        { key: "promotionId", value: "different" },
      ]),
    ).toBe(0);
  });

  it("counts purchases, not registrations, and retains canceled/refunded purchase history", async () => {
    await customer(); // Registration without a purchase.
    const first = await customer();
    const returning = await customer();
    await purchase(returning, start - 1);
    await purchase(returning, start, { status: "REFUNDED" });
    await purchase(first, start + 1);
    await purchase(first, start + 2, { status: "PARTIALLY_REFUNDED" });
    await purchase(first, end); // Exclusive end.
    await purchase(await customer(), start + 3, { paid: false });
    expect(await value("order_count")).toBe(3);
    expect(await value("new_customers")).toBe(1);
    expect(await value("active_customers")).toBe(2);
    expect(await value("repeat_customers")).toBe(2);
    expect(await value("repeat_orders")).toBe(2);
  });

  it("uses prior purchases across locations without adding them to the selected scope", async () => {
    const buyer = await customer();
    await purchase(buyer, start - 1, { location: "historical-other-location" });
    await purchase(buyer, start + 1);
    const scope: Scope = { kind: "location", locationId: "location-cebu-central" };
    expect(await value("order_count", scope)).toBe(1);
    expect(await value("new_customers", scope)).toBe(0);
    expect(await value("repeat_customers", scope)).toBe(1);
    expect(await value("repeat_orders", scope)).toBe(1);
  });

  it("counts exactly one first purchase when two commitments share an instant", async () => {
    const buyer = await customer();
    await purchase(buyer, start);
    await purchase(buyer, start);
    expect(await value("new_customers")).toBe(1);
    expect(await value("repeat_orders")).toBe(1);
  });

  it("keeps old formulas available as history without executing changed semantics", async () => {
    for (const code of ["order_count", "new_customers", "active_customers"]) {
      const old = await resolveMetricDefinition(env.DB, code, 1);
      expect(old.definition.availability).toBe("UNAVAILABLE");
      expect(old.queryKey).toBeNull();
      expect((await resolveMetricDefinition(env.DB, code)).definition.version).toBe(2);
    }
  });

  it("separates confirmed money from Order state and uses refund success dates, not retry dates", async () => {
    const orderId = await purchase(await customer(), start, { status: "REFUNDED" });
    const refundId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO payment_refund
      (id,payment_intent_id,amount_minor,currency,status,idempotency_key,created_at,updated_at,succeeded_at)
      VALUES (?,?,40,'PHP','SUCCEEDED',?,?,?,?)`)
      .bind(refundId, orderId, refundId, start, end + 1, start + 1)
      .run();
    const currency: AnalyticsDimension[] = [{ key: "currency", value: "PHP" }];
    expect(await value("received_amount", { kind: "global" }, currency)).toBe(100);
    expect(await value("refund_amount", { kind: "global" }, currency)).toBe(40);
    expect(
      await value("refund_amount", { kind: "global" }, [{ key: "currency", value: "USD" }]),
    ).toBe(0);
    expect(
      await value(
        "received_amount",
        { kind: "location", locationId: "different-location" },
        currency,
      ),
    ).toBe(0);
    const definition = await resolveMetricDefinition(env.DB, "refund_amount");
    expect(definition.definition.valueUnit).toBe("MINOR_UNITS");
    // A retained successful refund with no first-confirmation evidence is not
    // assigned a fabricated date from updated_at or presented as zero.
    await env.DB.prepare("UPDATE payment_refund SET succeeded_at=NULL WHERE id=?")
      .bind(refundId)
      .run();
    expect(
      await executeMetricQuery({
        database: env.DB,
        queryKey: definition.queryKey!,
        definition: definition.definition,
        window,
        scope: { kind: "global" },
        dimensions: currency,
        computedAt: end,
      }),
    ).toMatchObject({ availability: "UNAVAILABLE", points: [] });
    expect(
      await executeMetricQuery({
        database: env.DB,
        queryKey: definition.queryKey!,
        definition: definition.definition,
        window: {
          ...window,
          startAt: new Date(end + 2).toISOString(),
          endAt: new Date(end + 100).toISOString(),
        },
        scope: { kind: "global" },
        dimensions: currency,
        computedAt: end + 100,
      }),
    ).toMatchObject({ availability: "AVAILABLE", points: [{ value: 0 }] });
  });
});
