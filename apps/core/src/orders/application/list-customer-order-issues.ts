import type {
  CustomerOrderIssueCategory,
  CustomerOrderIssueStatus,
  CustomerOrderIssueView,
  RpcResult,
} from "@freshmarkets/contracts";
import { storageToCustomerIssueCategory } from "../domain/order-issue";

type ListQuery = { customerId: string; orderId: string; requestId: string };

export type CustomerIssueStorageRow = {
  issueId: string;
  orderId: string;
  category: keyof typeof storageToCustomerIssueCategory;
  status: string;
  details: string | null;
  affectedOrderItemIdsJson: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export function storageIssueStatusToCustomer(status: string): CustomerOrderIssueStatus {
  if (status === "SUBMITTED") return "SUBMITTED";
  if (status === "RESOLVED") return "RESOLVED";
  if (status === "ESCALATED") return "ESCALATED";
  return "IN_REVIEW";
}

function parseAffectedIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function toCustomerOrderIssueView(row: CustomerIssueStorageRow): CustomerOrderIssueView {
  const status = storageIssueStatusToCustomer(row.status);
  return {
    issueId: row.issueId,
    orderId: row.orderId,
    category: storageToCustomerIssueCategory[row.category] as CustomerOrderIssueCategory,
    status,
    description: row.details?.trim() || "No description was recorded.",
    affectedOrderItemIds: parseAffectedIds(row.affectedOrderItemIdsJson),
    resolutionMessage:
      status === "RESOLVED"
        ? "Our team marked this issue resolved."
        : status === "ESCALATED"
          ? "This issue needs additional review."
          : null,
    terminal: status === "RESOLVED",
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function listCustomerOrderIssues(
  database: D1Database,
  query: ListQuery,
): Promise<RpcResult<readonly CustomerOrderIssueView[]>> {
  const owned = await database
    .prepare("SELECT 1 AS found FROM grocery_order WHERE id=? AND customer_id=?")
    .bind(query.orderId, query.customerId)
    .first<{ found: number }>();
  if (!owned)
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: query.requestId },
    };

  const rows = await database
    .prepare(
      `SELECT i.id AS issueId, i.order_id AS orderId, i.category, i.status, i.details,
              i.version, i.created_at AS createdAt, i.updated_at AS updatedAt,
              COALESCE((SELECT json_group_array(oil.order_item_id)
                        FROM order_issue_line oil WHERE oil.issue_id=i.id), '[]')
                AS affectedOrderItemIdsJson
       FROM order_issue i
       WHERE i.order_id=? AND i.customer_id=?
       ORDER BY i.created_at,i.id`,
    )
    .bind(query.orderId, query.customerId)
    .all<CustomerIssueStorageRow>();

  return {
    ok: true,
    value: rows.results.map(toCustomerOrderIssueView),
    requestId: query.requestId,
  };
}
