import { expect, it } from "vitest";
import {
  orderIssueCategories,
  orderIssueStatuses,
  orderIssueActions,
  reconciliationCaseCategories,
} from "./admin-finance";

it("publishes the closed issue, reconciliation, and payment vocabularies", () => {
  expect(orderIssueCategories).toEqual([
    "MISSING_ITEM",
    "WRONG_ITEM",
    "DAMAGED",
    "QUALITY",
    "QUANTITY",
    "DELIVERY",
    "OTHER",
  ]);
  expect(orderIssueStatuses).toEqual([
    "SUBMITTED",
    "CLAIMED",
    "INVESTIGATING",
    "RESOLVED",
    "ESCALATED",
  ]);
  expect(orderIssueActions).toEqual(["CLAIM", "RESOLVE"]);
  expect(orderIssueActions).not.toContain("REOPEN");
  expect(reconciliationCaseCategories).toEqual([
    "UNMAPPED_PROVIDER_REFERENCE",
    "AMBIGUOUS_OUTCOME",
    "PROVIDER_TIMEOUT",
    "REACTION_FAILURE",
    "REFUND_UNRESOLVED",
  ]);
});
