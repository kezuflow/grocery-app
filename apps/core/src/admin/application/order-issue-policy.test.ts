import { describe, expect, it } from "vitest";
import { allowedOrderIssueActions } from "./order-issue-policy";

describe("order issue policy", () => {
  it("returns only the legal next actions for each issue state", () => {
    expect(allowedOrderIssueActions("SUBMITTED")).toEqual(["CLAIM"]);
    expect(allowedOrderIssueActions("CLAIMED")).toEqual(["RESOLVE"]);
    expect(allowedOrderIssueActions("INVESTIGATING")).toEqual(["RESOLVE"]);
    expect(allowedOrderIssueActions("ESCALATED")).toEqual(["RESOLVE"]);
    expect(allowedOrderIssueActions("RESOLVED")).toEqual([]);
  });
});
