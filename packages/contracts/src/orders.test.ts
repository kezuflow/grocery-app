import { expect, it } from "vitest";
import { customerOrderIssueCategories } from "./orders";

it("publishes the closed customer issue categories", () => {
  expect(customerOrderIssueCategories).toEqual([
    "MISSING_ITEM",
    "WRONG_ITEM",
    "DAMAGED_ITEM",
    "POOR_QUALITY",
    "QUANTITY_DISCREPANCY",
    "DELIVERY_ISSUE",
    "OTHER",
  ]);
});
