import type { OrderIssueAction, OrderIssueStatus } from "@freshmarkets/contracts";

const allowedActionsByStatus: Readonly<Record<OrderIssueStatus, ReadonlyArray<OrderIssueAction>>> =
  {
    SUBMITTED: ["CLAIM"],
    CLAIMED: ["RESOLVE"],
    INVESTIGATING: ["RESOLVE"],
    ESCALATED: ["RESOLVE"],
    RESOLVED: [],
  };

/** Legal next actions for the current issue state; authorization is checked separately. */
export function allowedOrderIssueActions(
  status: OrderIssueStatus,
): ReadonlyArray<OrderIssueAction> {
  return allowedActionsByStatus[status];
}
