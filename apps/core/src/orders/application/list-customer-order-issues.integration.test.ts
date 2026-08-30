import { describe, expect, it } from "vitest";
import { storageIssueStatusToCustomer } from "./list-customer-order-issues";

describe("customer issue status projection", () => {
  it("collapses Admin work states without exposing assignment workflow", () => {
    expect(storageIssueStatusToCustomer("SUBMITTED")).toBe("SUBMITTED");
    expect(storageIssueStatusToCustomer("CLAIMED")).toBe("IN_REVIEW");
    expect(storageIssueStatusToCustomer("INVESTIGATING")).toBe("IN_REVIEW");
    expect(storageIssueStatusToCustomer("RESOLVED")).toBe("RESOLVED");
    expect(storageIssueStatusToCustomer("ESCALATED")).toBe("ESCALATED");
  });
});
