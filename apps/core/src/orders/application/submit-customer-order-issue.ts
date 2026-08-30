import type {
  CustomerOrderIssueCategory,
  CustomerOrderIssueView,
  RpcResult,
} from "@freshmarkets/contracts";
import { validateCustomerOrderIssue } from "../domain/order-issue";
import {
  toCustomerOrderIssueView,
  type CustomerIssueStorageRow,
} from "./list-customer-order-issues";

type SubmitCommand = {
  customerId: string;
  orderId: string;
  category: CustomerOrderIssueCategory;
  description: string;
  affectedOrderItemIds: readonly string[];
  idempotencyKey: string;
  requestId: string;
  headers: Readonly<Record<string, string>>;
};

function failure(
  code: "NOT_FOUND" | "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT" | "INTERNAL_ERROR",
  message: string,
  requestId: string,
): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

const ISSUE_SELECT = `SELECT i.id AS issueId, i.order_id AS orderId, i.customer_id AS customerId,
       i.category, i.status, i.details, i.version, i.created_at AS createdAt,
       i.updated_at AS updatedAt,
       COALESCE((SELECT json_group_array(oil.order_item_id)
                 FROM order_issue_line oil WHERE oil.issue_id=i.id), '[]')
         AS affectedOrderItemIdsJson
FROM order_issue i WHERE i.idempotency_key=?`;

type ReplayRow = CustomerIssueStorageRow & { customerId: string };

function sameIds(json: string, expected: readonly string[]): boolean {
  try {
    const actual = JSON.parse(json) as unknown;
    return (
      Array.isArray(actual) &&
      [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000")
    );
  } catch {
    return false;
  }
}

function replayResult(
  row: ReplayRow,
  command: SubmitCommand,
  storageCategory: string,
  description: string,
  affectedOrderItemIds: readonly string[],
): RpcResult<CustomerOrderIssueView> {
  if (
    row.customerId !== command.customerId ||
    row.orderId !== command.orderId ||
    row.category !== storageCategory ||
    row.details !== description ||
    !sameIds(row.affectedOrderItemIdsJson, affectedOrderItemIds)
  )
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "That idempotency key was already used for a different issue request",
      command.requestId,
    );
  return { ok: true, value: toCustomerOrderIssueView(row), requestId: command.requestId };
}

export async function submitCustomerOrderIssue(
  database: D1Database,
  command: SubmitCommand,
): Promise<RpcResult<CustomerOrderIssueView>> {
  const order = await database
    .prepare(
      `SELECT o.status,
              (SELECT d.status FROM delivery_job d WHERE d.order_id=o.id ORDER BY d.created_at DESC LIMIT 1)
                AS deliveryStatus
       FROM grocery_order o WHERE o.id=? AND o.customer_id=?`,
    )
    .bind(command.orderId, command.customerId)
    .first<{ status: string; deliveryStatus: string | null }>();
  if (!order) return failure("NOT_FOUND", "Order not found", command.requestId);

  const validation = validateCustomerOrderIssue({
    category: command.category,
    description: command.description,
    affectedOrderItemIds: command.affectedOrderItemIds,
    orderStatus: order.status,
    deliveryStatus: order.deliveryStatus,
  });
  if (!validation.ok) return failure("VALIDATION_FAILED", validation.message, command.requestId);

  const replay = await database
    .prepare(ISSUE_SELECT)
    .bind(command.idempotencyKey)
    .first<ReplayRow>();
  if (replay)
    return replayResult(
      replay,
      command,
      validation.value.storageCategory,
      validation.value.description,
      validation.value.affectedOrderItemIds,
    );

  if (validation.value.affectedOrderItemIds.length > 0) {
    const placeholders = validation.value.affectedOrderItemIds.map(() => "?").join(",");
    const matching = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM order_item WHERE order_id=? AND id IN (${placeholders})`,
      )
      .bind(command.orderId, ...validation.value.affectedOrderItemIds)
      .first<{ count: number }>();
    if (matching?.count !== validation.value.affectedOrderItemIds.length)
      return failure(
        "VALIDATION_FAILED",
        "Every affected line must belong to this order",
        command.requestId,
      );
  }

  const issueId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    database
      .prepare(
        `INSERT INTO order_issue
           (id, order_id, customer_id, category, status, details, assigned_staff_id,
            resolution, version, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'SUBMITTED', ?, NULL, NULL, 1, ?, ?, ?)`,
      )
      .bind(
        issueId,
        command.orderId,
        command.customerId,
        validation.value.storageCategory,
        validation.value.description,
        command.idempotencyKey,
        now,
        now,
      ),
    ...validation.value.affectedOrderItemIds.map((orderItemId) =>
      database
        .prepare("INSERT INTO order_issue_line (issue_id, order_item_id) VALUES (?, ?)")
        .bind(issueId, orderItemId),
    ),
  ];
  try {
    await database.batch(statements);
  } catch {
    const raced = await database
      .prepare(ISSUE_SELECT)
      .bind(command.idempotencyKey)
      .first<ReplayRow>();
    if (raced)
      return replayResult(
        raced,
        command,
        validation.value.storageCategory,
        validation.value.description,
        validation.value.affectedOrderItemIds,
      );
    return failure("INTERNAL_ERROR", "The issue could not be submitted", command.requestId);
  }

  return {
    ok: true,
    value: {
      issueId,
      orderId: command.orderId,
      category: command.category,
      status: "SUBMITTED",
      description: validation.value.description,
      affectedOrderItemIds: validation.value.affectedOrderItemIds,
      resolutionMessage: null,
      terminal: false,
      version: 1,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    requestId: command.requestId,
  };
}
