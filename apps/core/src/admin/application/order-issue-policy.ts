import type { OrderIssueAction, OrderIssueStatus } from "@freshmarkets/contracts";

const allowedActionsByStatus: Readonly<Record<OrderIssueStatus, ReadonlyArray<OrderIssueAction>>> =
  {
    SUBMITTED: ["CLAIM"],
    CLAIMED: ["BEGIN_INVESTIGATION", "RESOLVE", "ESCALATE"],
    INVESTIGATING: ["RESOLVE", "ESCALATE"],
    ESCALATED: ["BEGIN_INVESTIGATION"],
    RESOLVED: [],
  };

/** Legal next actions for the current issue state; authorization is checked separately. */
export function allowedOrderIssueActions(
  status: OrderIssueStatus,
): ReadonlyArray<OrderIssueAction> {
  return allowedActionsByStatus[status];
}
