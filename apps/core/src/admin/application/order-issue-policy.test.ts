import { describe, expect, it } from "vitest";
import { allowedOrderIssueActions } from "./order-issue-policy";

describe("order issue policy", () => {
  it("returns only the legal next actions for each issue state", () => {
    expect(allowedOrderIssueActions("SUBMITTED")).toEqual(["CLAIM"]);
    expect(allowedOrderIssueActions("CLAIMED")).toEqual([
      "BEGIN_INVESTIGATION",
      "RESOLVE",
      "ESCALATE",
    ]);
    expect(allowedOrderIssueActions("INVESTIGATING")).toEqual(["RESOLVE", "ESCALATE"]);
    expect(allowedOrderIssueActions("ESCALATED")).toEqual(["BEGIN_INVESTIGATION"]);
    expect(allowedOrderIssueActions("RESOLVED")).toEqual([]);
  });
});
