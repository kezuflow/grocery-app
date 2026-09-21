import { describe, expect, it } from "vitest";
import {
  coordinateSchema,
  idempotencyKeySchema,
  positiveIntegerSchema,
  scheduledWeekQuerySchema,
  scheduledWeekViewSchema,
} from "./index";

describe("validation primitives", () => {
  it("rejects malformed IDs and idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("checkout-1").success).toBe(true);
  });

  it("accepts finite coordinates and positive integer quantities only", () => {
    expect(coordinateSchema.safeParse(Number.NaN).success).toBe(false);
    expect(positiveIntegerSchema.safeParse(2).success).toBe(true);
    expect(positiveIntegerSchema.safeParse(0).success).toBe(false);
  });
});

describe("Scheduled week order summary", () => {
  it("accepts the order summary and rejects unknown sections", () => {
    expect(scheduledWeekQuerySchema.parse({ section: "ORDER_SUMMARY" }).section).toBe(
      "ORDER_SUMMARY",
    );
    expect(scheduledWeekQuerySchema.safeParse({ section: "STOCK" }).success).toBe(false);
  });

  it("accepts bounded typed summary rows and full-scope totals", () => {
    expect(
      scheduledWeekViewSchema.safeParse({
        cycles: [],
        nextCycleCursor: null,
        week: null,
        page: {
          kind: "ORDER_SUMMARY",
          nextCursor: null,
          totals: {
            paidOrderCount: 2,
            productCount: 1,
            sellingOptionCount: 1,
            destinationCount: 2,
          },
          items: [
            {
              skuId: "sku-carrot-1kg",
              inventoryPoolId: "pool-carrot",
              productName: "Carrots",
              variantName: "1 kg",
              unitName: "GRAM",
              baseUnit: "GRAM",
              paidOrderCount: 2,
              soldUnitCount: 12,
              totalQuantityBase: 12000,
              destinationCount: 2,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
