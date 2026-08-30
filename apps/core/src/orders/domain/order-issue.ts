import type { CustomerOrderIssueCategory } from "@freshmarkets/contracts";

export const customerToStorageIssueCategory = {
  MISSING_ITEM: "MISSING_ITEM",
  WRONG_ITEM: "WRONG_ITEM",
  DAMAGED_ITEM: "DAMAGED",
  POOR_QUALITY: "QUALITY",
  QUANTITY_DISCREPANCY: "QUANTITY",
  DELIVERY_ISSUE: "DELIVERY",
  OTHER: "OTHER",
} as const satisfies Record<CustomerOrderIssueCategory, string>;

export const storageToCustomerIssueCategory = {
  MISSING_ITEM: "MISSING_ITEM",
  WRONG_ITEM: "WRONG_ITEM",
  DAMAGED: "DAMAGED_ITEM",
  QUALITY: "POOR_QUALITY",
  QUANTITY: "QUANTITY_DISCREPANCY",
  DELIVERY: "DELIVERY_ISSUE",
  OTHER: "OTHER",
} as const;

type ValidationInput = {
  category: CustomerOrderIssueCategory;
  description: string;
  affectedOrderItemIds: readonly string[];
  orderStatus: string;
  deliveryStatus: string | null;
};

type ValidationFailureCode =
  | "DESCRIPTION_REQUIRED"
  | "DESCRIPTION_TOO_LONG"
  | "OTHER_NOTES_REQUIRED"
  | "AFFECTED_LINE_REQUIRED"
  | "TOO_MANY_AFFECTED_LINES"
  | "DUPLICATE_AFFECTED_LINE"
  | "ORDER_STATE_UNSUPPORTED"
  | "DELIVERY_STATE_UNSUPPORTED";

export function validateCustomerOrderIssue(input: ValidationInput):
  | {
      ok: true;
      value: {
        storageCategory: (typeof customerToStorageIssueCategory)[CustomerOrderIssueCategory];
        description: string;
        affectedOrderItemIds: string[];
      };
    }
  | { ok: false; code: ValidationFailureCode; message: string } {
  const description = input.description.trim();
  if (!description)
    return { ok: false, code: "DESCRIPTION_REQUIRED", message: "Describe the issue" };
  if (description.length > 1000)
    return {
      ok: false,
      code: "DESCRIPTION_TOO_LONG",
      message: "Issue descriptions can contain at most 1000 characters",
    };
  if (input.category === "OTHER" && description.length < 20)
    return {
      ok: false,
      code: "OTHER_NOTES_REQUIRED",
      message: "Add enough detail so the team can understand this issue",
    };
  if (input.affectedOrderItemIds.length > 50)
    return {
      ok: false,
      code: "TOO_MANY_AFFECTED_LINES",
      message: "At most 50 order lines can be selected",
    };
  const affectedOrderItemIds = input.affectedOrderItemIds.map((id) => id.trim());
  if (new Set(affectedOrderItemIds).size !== affectedOrderItemIds.length)
    return {
      ok: false,
      code: "DUPLICATE_AFFECTED_LINE",
      message: "An affected line can be selected only once",
    };
  if (
    ["MISSING_ITEM", "WRONG_ITEM", "DAMAGED_ITEM", "POOR_QUALITY", "QUANTITY_DISCREPANCY"].includes(
      input.category,
    ) &&
    affectedOrderItemIds.length === 0
  )
    return {
      ok: false,
      code: "AFFECTED_LINE_REQUIRED",
      message: "Select at least one affected item",
    };
  if (
    ![
      "COMMITTED",
      "IN_FULFILLMENT",
      "PACKED",
      "DISPATCHED",
      "DELIVERED",
      "DELIVERY_FAILED",
    ].includes(input.orderStatus)
  )
    return {
      ok: false,
      code: "ORDER_STATE_UNSUPPORTED",
      message: "Issues cannot be submitted for this order state",
    };
  if (input.category === "DELIVERY_ISSUE" && input.deliveryStatus === "CANCELED")
    return {
      ok: false,
      code: "DELIVERY_STATE_UNSUPPORTED",
      message: "A delivery issue cannot be submitted for this delivery state",
    };
  return {
    ok: true,
    value: {
      storageCategory: customerToStorageIssueCategory[input.category],
      description,
      affectedOrderItemIds,
    },
  };
}
