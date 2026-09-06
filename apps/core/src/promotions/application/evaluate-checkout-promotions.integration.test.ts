import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { evaluateCheckoutPromotions } from "./evaluate-checkout-promotions";

async function seedCustomer(): Promise<string> {
  const customerId = `promotion-customer-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, current_period_ends_at, version, created_at, updated_at) VALUES (?, ?, 'offer-membership-monthly', 'ACTIVE', ?, ?, 1, ?, ?)",
    ).bind(`subscription-${customerId}`, customerId, now, now + 86_400_000, now, now),
  ]);
  return customerId;
}

function checkoutContext(customerId: string, requestedCodes: readonly string[] = []) {
  return {
    customerId,
    marketId: "market-metro-cebu",
    locationId: "location-cebu-central",
    fulfillmentMode: "SCHEDULED" as const,
    merchandiseSubtotalMinor: 60000,
    deliverySubtotalMinor: 5000,
    lineFacts: [
      {
        skuId: "sku-red-onion-500g",
        productId: "product-red-onion",
        categoryId: "category-vegetables",
        quantity: 1,
        lineSubtotalMinor: 60000,
      },
    ],
    requestedCodes,
    at: Date.now(),
  };
}

describe("D1 checkout promotion evaluation", () => {
  it("enforces global, customer, and grant usage limits at the write boundary", async () => {
    const customerId = await seedCustomer();
    const otherCustomerId = await seedCustomer();
    const suffix = crypto.randomUUID();
    const promotionId = `limited-${suffix}`;
    const grantId = `limited-grant-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO promotion
         (id,code,name,description,status,benefit_type,discount_minor,minimum_minor,starts_at,
          global_usage_limit,per_customer_usage_limit,automatic,priority,version,created_at,updated_at)
         VALUES (?,?,'Limited','', 'ACTIVE','ORDER_FIXED_DISCOUNT',100,0,?,2,1,0,0,1,?,?)`,
      ).bind(promotionId, `LIMIT_${suffix}`, now - 1, now, now),
      env.DB.prepare(
        `INSERT INTO promotion_grant
         (id,benefit_code,benefit_type,max_redemptions,status,customer_id,parameters_json,created_at,updated_at)
         VALUES (?,?,'ORDER_FIXED_DISCOUNT',3,'ACTIVE',NULL,'{}',?,?)`,
      ).bind(grantId, `LIMIT_${suffix}`, now, now),
    ]);
    const redemption = (id: string, customer: string) =>
      env.DB.prepare(
        `INSERT INTO promotion_redemption
           (id,grant_id,benefit_code,benefit_type,customer_id,subject_type,subject_id,redeemed_at,promotion_id)
           VALUES (?,?,?,'ORDER_FIXED_DISCOUNT',?,'grocery_order',?, ?,?)`,
      ).bind(id, grantId, `LIMIT_${suffix}`, customer, `subject-${id}`, now, promotionId);
    await redemption(`redemption-1-${suffix}`, customerId).run();
    await expect(redemption(`redemption-customer-${suffix}`, customerId).run()).rejects.toThrow(
      "PROMOTION_CUSTOMER_USAGE_LIMIT_REACHED",
    );
    await redemption(`redemption-2-${suffix}`, otherCustomerId).run();
    const thirdCustomer = await seedCustomer();
    await expect(redemption(`redemption-global-${suffix}`, thirdCustomer).run()).rejects.toThrow(
      "PROMOTION_GLOBAL_USAGE_LIMIT_REACHED",
    );
    const grantOnlyId = `grant-only-${suffix}`;
    await env.DB.prepare(
      `INSERT INTO promotion_grant
       (id,benefit_code,benefit_type,max_redemptions,status,customer_id,parameters_json,created_at,updated_at)
       VALUES (?,'GRANT_ONLY','ORDER_FIXED_DISCOUNT',1,'ACTIVE',NULL,'{}',?,?)`,
    )
      .bind(grantOnlyId, now, now)
      .run();
    const grantRedemption = (id: string, customer: string) =>
      env.DB.prepare(
        `INSERT INTO promotion_redemption
           (id,grant_id,benefit_code,benefit_type,customer_id,subject_type,subject_id,redeemed_at)
           VALUES (? ,?,'GRANT_ONLY','ORDER_FIXED_DISCOUNT',?,'grocery_order',?,?)`,
      ).bind(id, grantOnlyId, customer, `subject-${id}`, now);
    await grantRedemption(`grant-redemption-1-${suffix}`, customerId).run();
    await expect(
      grantRedemption(`grant-redemption-2-${suffix}`, otherCustomerId).run(),
    ).rejects.toThrow("PROMOTION_GRANT_USAGE_LIMIT_REACHED");
  });
  it("combines explicit, automatic, targeted, rule, and usage evidence without redemption", async () => {
    const customerId = await seedCustomer();
    const now = Date.now();
    const explicitId = `explicit-${crypto.randomUUID()}`;
    const deliveryId = `delivery-${crypto.randomUUID()}`;
    const code = `EXPLICIT_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO promotion (
          id, code, name, description, status, benefit_type, discount_minor, percent,
          minimum_minor, starts_at, automatic, priority, version, created_at, updated_at
        ) VALUES (?, ?, 'Explicit', '', 'ACTIVE', 'ORDER_FIXED_DISCOUNT', 7000, NULL,
                  50000, ?, 0, 0, 3, ?, ?)`,
      ).bind(explicitId, code, now - 1, now, now),
      env.DB.prepare(
        `INSERT INTO promotion (
          id, code, name, description, status, benefit_type, discount_minor, percent,
          minimum_minor, starts_at, automatic, priority, version, created_at, updated_at
        ) VALUES (?, ?, 'Delivery', '', 'ACTIVE', 'DELIVERY_FEE_DISCOUNT', NULL, 50,
                  0, ?, 1, 0, 2, ?, ?)`,
      ).bind(
        deliveryId,
        `DELIVERY_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        now - 1,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO promotion_rule (id, promotion_id, rule_type, parameters_json, sort_order, version, created_at, updated_at) VALUES (?, ?, 'MEMBER', '{}', 0, 1, ?, ?)",
      ).bind(crypto.randomUUID(), explicitId, now, now),
    ]);

    const result = await evaluateCheckoutPromotions(
      env.DB,
      checkoutContext(customerId, [code.toLowerCase()]),
    );
    expect(result.applications).toEqual([
      expect.objectContaining({ promotionId: explicitId, amountMinor: 7000, definitionVersion: 3 }),
      expect.objectContaining({ promotionId: deliveryId, amountMinor: 2500, definitionVersion: 2 }),
    ]);
    expect(result.feedback).toEqual([{ code, status: "APPLIED", message: "Promotion applied" }]);
    const redemptions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM promotion_redemption WHERE customer_id=? AND promotion_id IS NOT NULL",
    )
      .bind(customerId)
      .first<{ count: number }>();
    expect(redemptions?.count).toBe(0);
  });

  it("returns controlled feedback for a missing requested code", async () => {
    const customerId = await seedCustomer();
    const result = await evaluateCheckoutPromotions(
      env.DB,
      checkoutContext(customerId, ["DOES_NOT_EXIST"]),
    );
    expect(result.feedback).toEqual([
      { code: "DOES_NOT_EXIST", status: "INVALID", message: "Promotion code was not found" },
    ]);
  });
});
