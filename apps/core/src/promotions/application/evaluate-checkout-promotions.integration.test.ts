import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { evaluateCheckoutPromotions } from "./evaluate-checkout-promotions";

async function seedCustomer(retainedSubscription = false): Promise<string> {
  const customerId = `promotion-customer-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    ...(retainedSubscription
      ? [
          env.DB.prepare(
            "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, current_period_ends_at, version, created_at, updated_at) VALUES (?, ?, 'offer-membership-monthly', 'ACTIVE', ?, ?, 1, ?, ?)",
          ).bind(`subscription-${customerId}`, customerId, now, now + 86_400_000, now, now),
        ]
      : []),
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
  // Redemption-limit races are exercised through actual payment commitment in
  // orders/application/apply-checkout-payment-reaction.integration.test.ts.
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
        ) VALUES (?, ?, 'Delivery', '', 'ACTIVE', 'DELIVERY_PERCENT_DISCOUNT', NULL, 50,
                  0, ?, 1, 0, 2, ?, ?)`,
      ).bind(
        deliveryId,
        `DELIVERY_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        now - 1,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO promotion_rule (id, promotion_id, rule_type, parameters_json, sort_order, version, created_at, updated_at) VALUES (?, ?, 'FIRST_ORDER', '{}', 0, 1, ?, ?)",
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

for (const ruleType of ["MEMBER", "NON_MEMBER"] as const) {
  it(`never applies a retained ${ruleType} rule to new commerce`, async () => {
    const customerId = await seedCustomer(true);
    const id = crypto.randomUUID();
    const code = `RETIRED_${id}`.toUpperCase();
    const now = Date.now();
    if (ruleType === "NON_MEMBER")
      await env.DB.prepare("UPDATE subscription SET status='CANCELED' WHERE customer_id=?")
        .bind(customerId)
        .run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO promotion(id,code,name,description,status,benefit_type,discount_minor,minimum_minor,starts_at,automatic,priority,version,created_at,updated_at) VALUES (?,?,'Retained promotion','','ACTIVE','ORDER_FIXED_DISCOUNT',100,0,?,0,0,1,?,?)",
      ).bind(id, code, now - 1, now, now),
      env.DB.prepare(
        "INSERT INTO promotion_rule(id,promotion_id,rule_type,parameters_json,sort_order,version,created_at,updated_at) VALUES (?,?,?,'{}',0,1,?,?)",
      ).bind(crypto.randomUUID(), id, ruleType, now, now),
    ]);
    const result = await evaluateCheckoutPromotions(env.DB, checkoutContext(customerId, [code]));
    expect(result.applications.filter((item) => item.promotionId === id)).toEqual([]);
    expect(result.feedback).toContainEqual({
      code,
      status: "INELIGIBLE",
      message: "Promotion is not eligible for this order",
    });
    expect(
      await env.DB.prepare("SELECT rule_type FROM promotion_rule WHERE promotion_id=?")
        .bind(id)
        .first(),
    ).toEqual({ rule_type: ruleType });
  });
}

it("keeps unsupported legacy types and invalid stored percentages ineligible", async () => {
  const customerId = await seedCustomer();
  const id = crypto.randomUUID();
  const now = Date.now();
  const codes = [`LEGACY_${id}`, `INVALID_PERCENT_${id}`].map((code) => code.toUpperCase());
  await env.DB.batch(
    codes.map((code, index) =>
      env.DB.prepare(
        "INSERT INTO promotion(id,code,name,description,status,benefit_type,percent,minimum_minor,starts_at,automatic,priority,version,created_at,updated_at) VALUES (?,?,'Retained definition','','ACTIVE',?,?,0,?,0,0,1,?,?)",
      ).bind(
        `${id}-${index}`,
        code,
        index === 0 ? "DELIVERY_FEE_DISCOUNT" : "DELIVERY_PERCENT_DISCOUNT",
        index === 0 ? 25 : 250,
        now - 1,
        now,
        now,
      ),
    ),
  );
  const result = await evaluateCheckoutPromotions(env.DB, checkoutContext(customerId, codes));
  expect(result.feedback).toEqual(
    codes.map((code) => ({
      code,
      status: "INELIGIBLE",
      message: "Promotion is not eligible for this order",
    })),
  );
  expect(result.applications.filter((item) => codes.includes(item.code))).toEqual([]);
});
