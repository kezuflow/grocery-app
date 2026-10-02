import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  getOrderFeedback,
  listPopularWithCart,
  listSavedProducts,
  setSavedProduct,
  submitOrderFeedback,
} from "./engagement";

const requestId = "0f0d1b62-753e-4dc5-906a-aee05a792d36";

async function customer(id: string) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES(?,?,'active',0,0)",
  )
    .bind(id, `auth-${id}`)
    .run();
}

describe("customer engagement", () => {
  it("keeps saved products customer scoped and allows removal", async () => {
    await customer("engagement-a");
    await customer("engagement-b");
    const product = await env.DB.prepare(
      "SELECT id FROM product WHERE status='active' LIMIT 1",
    ).first<{ id: string }>();
    expect(product).not.toBeNull();
    expect(
      (
        await setSavedProduct(env.DB, {
          customerId: "engagement-a",
          productId: product!.id,
          saved: true,
          requestId,
        })
      ).ok,
    ).toBe(true);
    const own = await listSavedProducts(env.DB, "engagement-a", requestId);
    const other = await listSavedProducts(env.DB, "engagement-b", requestId);
    expect(own.ok && own.value.map((item) => item.productId)).toContain(product!.id);
    expect(other.ok && other.value).toEqual([]);
    await setSavedProduct(env.DB, {
      customerId: "engagement-a",
      productId: product!.id,
      saved: false,
      requestId,
    });
    const removed = await listSavedProducts(env.DB, "engagement-a", requestId);
    expect(removed.ok && removed.value).toEqual([]);
  });

  it("shows no recommendation for sparse purchase history", async () => {
    await customer("engagement-a");
    const result = await listPopularWithCart(env.DB, "engagement-a", requestId);
    expect(result).toMatchObject({ ok: true, value: [] });
  });

  it("derives co-purchases only after two paid orders from different customers", async () => {
    await customer("reco-a");
    await customer("reco-b");
    const products = await env.DB.prepare(`SELECT p.id productId,MIN(s.id) skuId FROM product p
      JOIN sku s ON s.product_id=p.id JOIN sku_location_availability availability ON availability.sku_id=s.id
      WHERE p.status='active' AND availability.location_id='location-cebu-central'
        AND availability.availability_status='AVAILABLE' GROUP BY p.id ORDER BY p.id LIMIT 2`).all<{
      productId: string;
      skuId: string;
    }>();
    expect(products.results).toHaveLength(2);
    const [chosen, candidate] = products.results;
    await env.DB.prepare(
      "INSERT INTO cart(id,customer_id,location_id,status,version,created_at,updated_at) VALUES('reco-cart','reco-a','location-cebu-central','ACTIVE',1,0,0)",
    ).run();
    await env.DB.prepare("INSERT INTO cart_item(cart_id,sku_id,quantity) VALUES('reco-cart',?,1)")
      .bind(chosen!.skuId)
      .run();
    for (const [index, customerId] of ["reco-a", "reco-b"].entries()) {
      const key = `reco-${index}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES(?,'GROCERY_CHECKOUT','checkout_quote',?,?,10000,'PHP','SUCCEEDED',?,1,0,0)",
        ).bind(`${key}-intent`, `${key}-quote`, customerId, `${key}-intent-key`),
        env.DB.prepare(
          "INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES(?,?,?,10000,'PHP','SUCCEEDED','mock',?,?,0,0)",
        ).bind(
          `${key}-attempt`,
          customerId,
          `${key}-intent`,
          `${key}-provider`,
          `${key}-attempt-key`,
        ),
        env.DB.prepare(
          "INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at) VALUES(?,?,NULL,'INSTANT','{}','COMMITTED',10000,'PHP',?,1,?)",
        ).bind(`${key}-order`, customerId, `${key}-attempt`, index),
        env.DB.prepare(
          "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity) VALUES(?,?,?,'Chosen','Pack','pack',1,5000,5000,1)",
        ).bind(`${key}-chosen`, `${key}-order`, chosen!.skuId),
        env.DB.prepare(
          "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity) VALUES(?,?,?,'Candidate','Pack','pack',1,5000,5000,1)",
        ).bind(`${key}-candidate`, `${key}-order`, candidate!.skuId),
        env.DB.prepare(
          "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES(?,?,?,?,0)",
        ).bind(`${key}-reaction`, `${key}-intent`, `${key}-reaction-id`, `${key}-order`),
      ]);
      const recommendation = await listPopularWithCart(env.DB, "reco-a", requestId);
      expect(
        recommendation.ok &&
          recommendation.value.some((item) => item.productId === candidate!.productId),
      ).toBe(index === 1);
    }
  });

  it("rejects feedback for another customer's order without writing", async () => {
    await customer("engagement-a");
    const result = await submitOrderFeedback(env.DB, {
      orderId: "unknown-order",
      customerId: "engagement-a",
      rating: 5,
      comment: "Great",
      requestId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await getOrderFeedback(env.DB, {
        orderId: "unknown-order",
        customerId: "engagement-a",
        requestId,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM customer_order_feedback").first<{
      count: number;
    }>();
    expect(count?.count).toBe(0);
  });

  it("accepts one private review only after delivery and replays an exact retry", async () => {
    await customer("engagement-a");
    await customer("engagement-b");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES('engagement-intent','GROCERY_CHECKOUT','checkout_quote','engagement-quote','engagement-a',10000,'PHP','SUCCEEDED','engagement-intent-key',1,0,0)",
      ),
      env.DB.prepare(
        "INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES('engagement-attempt','engagement-a','engagement-intent',10000,'PHP','SUCCEEDED','mock','engagement-provider','engagement-attempt-key',0,0)",
      ),
      env.DB.prepare(
        "INSERT INTO grocery_order(id,customer_id,cycle_id,fulfillment_mode,address_snapshot_json,status,total_minor,currency,payment_id,version,created_at) VALUES('engagement-order','engagement-a',NULL,'INSTANT','{}','COMMITTED',10000,'PHP','engagement-attempt',1,0)",
      ),
      env.DB.prepare(
        "INSERT INTO delivery_job(id,order_id,cycle_id,fulfillment_mode,location_id,zone_id,promised_at,status,address_snapshot_json,version,created_at,updated_at) VALUES('engagement-delivery','engagement-order',NULL,'INSTANT','location-cebu-central','zone-cebu-city-core',NULL,'UNASSIGNED','{}',1,0,0)",
      ),
    ]);
    const input = {
      orderId: "engagement-order",
      customerId: "engagement-a",
      rating: 5 as const,
      comment: "Fresh and on time",
      requestId,
    };
    expect(await submitOrderFeedback(env.DB, input)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    await env.DB.prepare(
      "UPDATE grocery_order SET status='DELIVERED' WHERE id='engagement-order'",
    ).run();
    expect(await submitOrderFeedback(env.DB, input)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    await env.DB.prepare(
      "UPDATE delivery_job SET status='DELIVERED' WHERE id='engagement-delivery'",
    ).run();
    const first = await submitOrderFeedback(env.DB, input);
    expect(first).toMatchObject({ ok: true, value: { rating: 5, comment: "Fresh and on time" } });
    expect(await submitOrderFeedback(env.DB, input)).toEqual(first);
    expect(await submitOrderFeedback(env.DB, { ...input, rating: 4 })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await getOrderFeedback(env.DB, { ...input, customerId: "engagement-b" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM customer_order_feedback").first<{
      count: number;
    }>();
    expect(count?.count).toBe(1);
  });
});
