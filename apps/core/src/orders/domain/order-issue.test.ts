import { describe, expect, it } from "vitest";
import { validateCustomerOrderIssue } from "./order-issue";

describe("customer order issue policy", () => {
  it("normalizes controlled categories and requires affected lines for item issues", () => {
    expect(
      validateCustomerOrderIssue({
        category: "DAMAGED_ITEM",
        description: "  Two tomatoes were crushed.  ",
        affectedOrderItemIds: ["item-1"],
        orderStatus: "DELIVERED",
        deliveryStatus: "DELIVERED",
      }),
    ).toEqual({
      ok: true,
      value: {
        storageCategory: "DAMAGED",
        description: "Two tomatoes were crushed.",
        affectedOrderItemIds: ["item-1"],
      },
    });
    expect(
      validateCustomerOrderIssue({
        category: "POOR_QUALITY",
        description: "Produce quality was not acceptable.",
        affectedOrderItemIds: [],
        orderStatus: "DELIVERED",
        deliveryStatus: "DELIVERED",
      }),
    ).toMatchObject({ ok: false, code: "AFFECTED_LINE_REQUIRED" });
  });

  it("bounds description, requires useful OTHER notes, and rejects duplicate lines", () => {
    const base = {
      category: "OTHER" as const,
      orderStatus: "DELIVERED",
      deliveryStatus: "DELIVERED",
      affectedOrderItemIds: [] as string[],
    };
    expect(validateCustomerOrderIssue({ ...base, description: "" })).toMatchObject({
      ok: false,
      code: "DESCRIPTION_REQUIRED",
    });
    expect(validateCustomerOrderIssue({ ...base, description: "too short" })).toMatchObject({
      ok: false,
      code: "OTHER_NOTES_REQUIRED",
    });
    expect(validateCustomerOrderIssue({ ...base, description: "x".repeat(1001) })).toMatchObject({
      ok: false,
      code: "DESCRIPTION_TOO_LONG",
    });
    expect(
      validateCustomerOrderIssue({
        ...base,
        category: "WRONG_ITEM",
        description: "The received item was different.",
        affectedOrderItemIds: ["item-1", "item-1"],
      }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_AFFECTED_LINE" });
  });

  it("accepts supported active/delivered states and fails closed for terminal orders or canceled delivery", () => {
    const base = {
      category: "DELIVERY_ISSUE" as const,
      description: "The delivery arrived much later than promised.",
      affectedOrderItemIds: [] as string[],
    };
    expect(
      validateCustomerOrderIssue({
        ...base,
        orderStatus: "DISPATCHED",
        deliveryStatus: "EN_ROUTE",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateCustomerOrderIssue({
        ...base,
        orderStatus: "CANCELED",
        deliveryStatus: "CANCELED",
      }),
    ).toMatchObject({ ok: false, code: "ORDER_STATE_UNSUPPORTED" });
    expect(
      validateCustomerOrderIssue({
        ...base,
        orderStatus: "DELIVERED",
        deliveryStatus: "CANCELED",
      }),
    ).toMatchObject({ ok: false, code: "DELIVERY_STATE_UNSUPPORTED" });
  });
});
