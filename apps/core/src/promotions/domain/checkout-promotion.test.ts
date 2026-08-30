import { describe, expect, it } from "vitest";
import {
  evaluateCheckoutPromotionCandidates,
  type CheckoutPromotionCandidate,
} from "./checkout-promotion";

const at = Date.parse("2026-08-30T00:00:00.000Z");
const context = {
  customerId: "customer-1",
  marketId: "market-1",
  locationId: "location-1",
  fulfillmentMode: "SCHEDULED" as const,
  merchandiseSubtotalMinor: 10000,
  deliverySubtotalMinor: 2000,
  lineFacts: [
    {
      skuId: "sku-1",
      productId: "product-1",
      categoryId: "category-1",
      quantity: 1,
      lineSubtotalMinor: 10000,
    },
  ],
  requestedCodes: [] as string[],
  at,
};
const facts = { firstOrder: true, newCustomer: true, member: true, segmentIds: ["segment-1"] };

function candidate(
  overrides: Partial<CheckoutPromotionCandidate> = {},
): CheckoutPromotionCandidate {
  return {
    id: "promotion-a",
    code: "SAVE10",
    name: "Save ten",
    status: "ACTIVE",
    startsAt: at - 1,
    endsAt: at + 1,
    globalUsageLimit: null,
    perCustomerUsageLimit: null,
    globalUsageCount: 0,
    customerUsageCount: 0,
    automatic: true,
    priority: 0,
    version: 1,
    grant: null,
    benefit: {
      type: "ORDER_PERCENT_DISCOUNT",
      percent: 10,
      discountMinor: null,
      maximumDiscountMinor: null,
    },
    rules: [],
    ...overrides,
  };
}

describe("checkout promotion selection", () => {
  it("lets an explicitly requested valid benefit win each component", () => {
    const result = evaluateCheckoutPromotionCandidates(
      { ...context, requestedCodes: ["EXPLICIT", "SHIP"] },
      facts,
      [
        candidate({
          id: "automatic",
          code: "AUTO50",
          benefit: {
            type: "ORDER_PERCENT_DISCOUNT",
            percent: 50,
            discountMinor: null,
            maximumDiscountMinor: null,
          },
        }),
        candidate({
          id: "explicit",
          code: "EXPLICIT",
          automatic: false,
          benefit: {
            type: "ORDER_FIXED_DISCOUNT",
            percent: null,
            discountMinor: 500,
            maximumDiscountMinor: null,
          },
        }),
        candidate({
          id: "ship",
          code: "SHIP",
          automatic: false,
          benefit: {
            type: "DELIVERY_FEE_WAIVER",
            percent: null,
            discountMinor: null,
            maximumDiscountMinor: null,
          },
        }),
      ],
    );
    expect(result.applications).toEqual([
      expect.objectContaining({
        promotionId: "explicit",
        component: "MERCHANDISE",
        amountMinor: 500,
      }),
      expect.objectContaining({ promotionId: "ship", component: "DELIVERY", amountMinor: 2000 }),
    ]);
  });

  it("uses highest value then stable promotion ID for automatic and targeted fallback", () => {
    const result = evaluateCheckoutPromotionCandidates(context, facts, [
      candidate({
        id: "z-promo",
        code: "Z",
        benefit: {
          type: "ORDER_FIXED_DISCOUNT",
          percent: null,
          discountMinor: 1000,
          maximumDiscountMinor: null,
        },
      }),
      candidate({
        id: "a-promo",
        code: "A",
        automatic: false,
        grant: { id: "grant-a", maxRedemptions: 1, redemptionCount: 0 },
        benefit: {
          type: "ORDER_FIXED_DISCOUNT",
          percent: null,
          discountMinor: 1000,
          maximumDiscountMinor: null,
        },
      }),
    ]);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0]?.promotionId).toBe("a-promo");
  });

  it("rounds percentages down and caps every benefit at its component and configured cap", () => {
    const merchandise = evaluateCheckoutPromotionCandidates(
      { ...context, merchandiseSubtotalMinor: 10001 },
      facts,
      [
        candidate({
          benefit: {
            type: "ORDER_PERCENT_DISCOUNT",
            percent: 33,
            discountMinor: null,
            maximumDiscountMinor: 1200,
          },
        }),
      ],
    );
    expect(merchandise.applications[0]?.amountMinor).toBe(1200);
    const delivery = evaluateCheckoutPromotionCandidates(context, facts, [
      candidate({
        benefit: {
          type: "DELIVERY_FEE_DISCOUNT",
          percent: 100,
          discountMinor: null,
          maximumDiscountMinor: 500,
        },
      }),
    ]);
    expect(delivery.applications[0]?.amountMinor).toBe(500);
  });

  it("enforces effective time, limits, grants, and closed rules", () => {
    const ruleTypes = [
      "FIRST_ORDER",
      "NEW_CUSTOMER",
      "MEMBER",
      "MINIMUM_SUBTOTAL",
      "CUSTOMER_SEGMENT",
      "SPECIFIC_CUSTOMERS",
    ] as const;
    const eligible = candidate({
      automatic: false,
      grant: { id: "grant", maxRedemptions: 2, redemptionCount: 1 },
      rules: ruleTypes.map((type) => ({
        type,
        parameters:
          type === "MINIMUM_SUBTOTAL"
            ? { minimumMinor: 10000 }
            : type === "CUSTOMER_SEGMENT"
              ? { segmentId: "segment-1" }
              : type === "SPECIFIC_CUSTOMERS"
                ? { customerIds: ["customer-1"] }
                : {},
      })),
    });
    expect(
      evaluateCheckoutPromotionCandidates(context, facts, [eligible]).applications,
    ).toHaveLength(1);
    for (const blocked of [
      candidate({ endsAt: at }),
      candidate({ globalUsageLimit: 1, globalUsageCount: 1 }),
      candidate({ perCustomerUsageLimit: 1, customerUsageCount: 1 }),
      candidate({ rules: [{ type: "NON_MEMBER", parameters: {} }] }),
    ]) {
      expect(
        evaluateCheckoutPromotionCandidates(context, facts, [blocked]).applications,
      ).toHaveLength(0);
    }
  });

  it("returns controlled invalid, expired, ineligible, duplicate, and not-selected feedback", () => {
    const result = evaluateCheckoutPromotionCandidates(
      { ...context, requestedCodes: ["missing", "OLD", "NOPE", "SAVE10", "SAVE10", "SECOND"] },
      facts,
      [
        candidate({ id: "old", code: "OLD", endsAt: at }),
        candidate({ id: "nope", code: "NOPE", rules: [{ type: "NON_MEMBER", parameters: {} }] }),
        candidate(),
        candidate({
          id: "second",
          code: "SECOND",
          automatic: false,
          benefit: {
            type: "ORDER_FIXED_DISCOUNT",
            percent: null,
            discountMinor: 1,
            maximumDiscountMinor: null,
          },
        }),
      ],
    );
    expect(result.feedback.map((item) => item.status)).toEqual([
      "INVALID",
      "EXPIRED",
      "INELIGIBLE",
      "APPLIED",
      "DUPLICATE",
      "NOT_SELECTED",
    ]);
  });
});
