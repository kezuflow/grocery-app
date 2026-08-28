import type {
  AdminMembershipDetailRequest,
  AdminMembershipListRequest,
  AdminMembershipPage,
  AdminMembershipSummary,
  AdminOrderDetail,
  AdminOrderDetailRequest,
  AdminOrderIssuePage,
  AdminOrderIssueDetail,
  AdminOrderIssueDetailRequest,
  AdminOrderIssueListRequest,
  AdminOrderIssueView,
  AdminOrderListRequest,
  AdminOrderPage,
  AdminOrderSummary,
  AdminPaymentListRequest,
  AdminPaymentPage,
  AdminPaymentSummary,
  AdminReconciliationCaseView,
  AdminReconciliationListRequest,
  AdminReconciliationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  boundListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";

const ORDER_SELECT = `
  SELECT o.id AS orderId, u.email AS customerEmail, o.status, o.total_minor AS totalMinor,
         o.currency, o.created_at AS committedAt, o.version,
         (SELECT pi.status FROM order_payment_reaction opr
          JOIN payment_intent pi ON pi.id = opr.payment_intent_id
          WHERE opr.order_id = o.id ORDER BY pi.created_at DESC LIMIT 1) AS paymentStatus,
         (SELECT f.status FROM fulfillment_record f WHERE f.order_id = o.id LIMIT 1) AS fulfillmentStatus,
          (SELECT d.status FROM delivery_job d WHERE d.order_id = o.id LIMIT 1) AS deliveryStatus
  FROM grocery_order o JOIN customer c ON c.id = o.customer_id JOIN user u ON u.id = c.auth_user_id`;

function toOrderSummary(row: {
  orderId: string;
  customerEmail: string;
  status: string;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  committedAt: number;
  version: number;
}): AdminOrderSummary {
  return {
    orderId: row.orderId,
    customerEmail: row.customerEmail,
    status: row.status,
    totalMinor: row.totalMinor,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    deliveryStatus: row.deliveryStatus,
    committedAt: new Date(row.committedAt).toISOString(),
    version: row.version,
  };
}

/** Bounded keyset listing of orders, newest first. */
export async function listAdminOrders(
  deps: FinanceAdministrationDeps,
  request: AdminOrderListRequest,
): Promise<RpcResult<AdminOrderPage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (request.status !== undefined && request.status !== "") {
    clauses.push("o.status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(o.created_at < ? OR (o.created_at = ? AND o.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<{
      orderId: string;
      customerEmail: string;
      status: string;
      totalMinor: number;
      currency: string;
      paymentStatus: string | null;
      fulfillmentStatus: string | null;
      deliveryStatus: string | null;
      committedAt: number;
      version: number;
    }>();
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map(toOrderSummary);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.committedAt, id: last.orderId }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One order's admin detail with item snapshots and recent audit. */
export async function getAdminOrder(
  deps: FinanceAdministrationDeps,
  request: AdminOrderDetailRequest,
): Promise<RpcResult<AdminOrderDetail>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.read");
  if (!access.ok) return access;

  const row = await deps.db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(request.orderId).first<{
    orderId: string;
    customerEmail: string;
    status: string;
    totalMinor: number;
    currency: string;
    paymentStatus: string | null;
    fulfillmentStatus: string | null;
    deliveryStatus: string | null;
    committedAt: number;
    version: number;
  }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: request.requestId },
    };
  }

  const items = await deps.db
    .prepare(
      `SELECT product_name_snapshot AS skuName, quantity AS quantity,
              unit_price_minor AS unitPriceMinor, line_total_minor AS lineTotalMinor
       FROM order_item WHERE order_id = ?`,
    )
    .bind(request.orderId)
    .all<{ skuName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>();

  const auditRows = await deps.db
    .prepare(
      `SELECT id, occurred_at AS occurredAt, action, reason FROM audit_event
       WHERE aggregate_type = 'order' AND aggregate_id = ?
       ORDER BY occurred_at DESC, id DESC LIMIT 10`,
    )
    .bind(request.orderId)
    .all<{ id: string; occurredAt: number; action: string; reason: string | null }>();

  const detail: AdminOrderDetail = {
    ...toOrderSummary(row),
    items: items.results,
    recentAudit: auditRows.results.map((audit) => ({
      auditEventId: audit.id,
      occurredAt: new Date(audit.occurredAt).toISOString(),
      action: audit.action,
      reason: audit.reason,
    })),
  };
  return { ok: true, value: detail, requestId: request.requestId };
}

const PAYMENT_SELECT = `
  SELECT pi.id AS paymentIntentId, pi.purpose, u.email AS customerEmail,
         pi.amount_minor AS amountMinor, pi.currency, pi.status,
         pi.created_at AS createdAt,
         (SELECT COALESCE(SUM(r.amount_minor), 0) FROM payment_refund r
          WHERE r.payment_intent_id = pi.id AND r.status = 'SUCCEEDED') AS refundedMinor
  FROM payment_intent pi LEFT JOIN customer c ON c.id = pi.customer_id
  LEFT JOIN user u ON u.id = c.auth_user_id`;

/** Bounded keyset listing of payment intents with refunded totals. */
export async function listAdminPayments(
  deps: FinanceAdministrationDeps,
  request: AdminPaymentListRequest,
): Promise<RpcResult<AdminPaymentPage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (request.status !== undefined && request.status !== "") {
    clauses.push("pi.status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(pi.created_at < ? OR (pi.created_at = ? AND pi.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(`${PAYMENT_SELECT} ${where} ORDER BY pi.created_at DESC, pi.id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<{
      paymentIntentId: string;
      purpose: string;
      customerEmail: string | null;
      amountMinor: number;
      currency: string;
      status: string;
      createdAt: number;
      refundedMinor: number;
    }>();
  const hasMore = rows.results.length > limit;
  const items: AdminPaymentSummary[] = rows.results.slice(0, limit).map((row) => ({
    paymentIntentId: row.paymentIntentId,
    purpose: row.purpose,
    customerEmail: row.customerEmail ?? "—",
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    refundedMinor: row.refundedMinor,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  const pageRows = rows.results.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeStaffCursor({ createdAt: last.createdAt, id: last.paymentIntentId })
      : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** Bounded reconciliation queue. */
export async function listAdminReconciliationCases(
  deps: FinanceAdministrationDeps,
  request: AdminReconciliationListRequest,
): Promise<RpcResult<AdminReconciliationPage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (request.status !== undefined) {
    clauses.push("status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT id, payment_intent_id AS paymentIntentId, category, status,
              details_json AS details, created_at AS createdAt, resolved_at AS resolvedAt
       FROM payment_reconciliation_case ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      paymentIntentId: string | null;
      category: AdminReconciliationCaseView["category"];
      status: "OPEN" | "RESOLVED";
      details: string;
      createdAt: number;
      resolvedAt: number | null;
    }>();
  const hasMore = rows.results.length > limit;
  const items: AdminReconciliationCaseView[] = rows.results.slice(0, limit).map((row) => ({
    caseId: row.id,
    paymentIntentId: row.paymentIntentId,
    category: row.category,
    status: row.status,
    details: row.details,
    createdAt: new Date(row.createdAt).toISOString(),
    resolvedAt: row.resolvedAt === null ? null : new Date(row.resolvedAt).toISOString(),
  }));
  const pageRows = rows.results.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

const MEMBERSHIP_SELECT = `
  SELECT s.id AS subscriptionId, u.email AS customerEmail, s.status AS state,
         s.cancel_at_period_end AS cancelAtPeriodEnd,
         s.current_period_ends_at AS currentPeriodEndsAt, s.version,
         s.created_at AS created_at
  FROM subscription s JOIN customer c ON c.id = s.customer_id
  JOIN user u ON u.id = c.auth_user_id`;

/** Bounded membership list for global membership readers. */
export async function listAdminMemberships(
  deps: FinanceAdministrationDeps,
  request: AdminMembershipListRequest,
): Promise<RpcResult<AdminMembershipPage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clause = cursor ? "WHERE (s.created_at < ? OR (s.created_at = ? AND s.id < ?))" : "";
  const binds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const rows = await deps.db
    .prepare(`${MEMBERSHIP_SELECT} ${clause} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<{
      subscriptionId: string;
      customerEmail: string;
      state: string;
      cancelAtPeriodEnd: number;
      currentPeriodEndsAt: number | null;
      version: number;
      created_at: number;
    }>();
  void 0;
  const hasMore = rows.results.length > limit;
  const items: AdminMembershipSummary[] = rows.results.slice(0, limit).map((row) => ({
    subscriptionId: row.subscriptionId,
    customerEmail: row.customerEmail,
    state: row.state,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    currentPeriodEndsAt:
      row.currentPeriodEndsAt === null ? null : new Date(row.currentPeriodEndsAt).toISOString(),
    version: row.version,
  }));
  const last = rows.results[rows.results.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeStaffCursor({ createdAt: last.created_at, id: last.subscriptionId })
      : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One membership summary by subscription id. */
export async function getAdminMembership(
  deps: FinanceAdministrationDeps,
  request: AdminMembershipDetailRequest,
): Promise<RpcResult<AdminMembershipSummary>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.read");
  if (!access.ok) return access;
  const row = await deps.db
    .prepare(`${MEMBERSHIP_SELECT} WHERE s.id = ?`)
    .bind(request.subscriptionId)
    .first<Omit<AdminMembershipSummary, "cancelAtPeriodEnd"> & { cancelAtPeriodEnd: number }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Membership not found", requestId: request.requestId },
    };
  }
  return {
    ok: true,
    value: { ...row, cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1 },
    requestId: request.requestId,
  };
}

/** Bounded order-issue queue with optional status filter. */
export async function listAdminOrderIssues(
  deps: FinanceAdministrationDeps,
  request: AdminOrderIssueListRequest,
): Promise<RpcResult<AdminOrderIssuePage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.read");
  if (!access.ok) return access;

  const limit = boundListLimit(request.limit);
  if (limit === "invalid") {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  }
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
    }
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (request.status !== undefined) {
    clauses.push("status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT id, order_id AS orderId, category, status, details,
              assigned_staff_id AS assignedStaffId, resolution, version, created_at AS createdAt
       FROM order_issue ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      orderId: string;
      category: AdminOrderIssueView["category"];
      status: AdminOrderIssueView["status"];
      details: string | null;
      assignedStaffId: string | null;
      resolution: string | null;
      version: number;
      createdAt: number;
    }>();
  const hasMore = rows.results.length > limit;
  const items: AdminOrderIssueView[] = rows.results.slice(0, limit).map((row) => ({
    issueId: row.id,
    orderId: row.orderId,
    category: row.category,
    status: row.status,
    details: row.details,
    assignedStaffId: row.assignedStaffId,
    resolution: row.resolution,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  const last = rows.results[rows.results.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One order issue detail by id. */
export async function getAdminOrderIssue(
  deps: FinanceAdministrationDeps,
  request: AdminOrderIssueDetailRequest,
): Promise<RpcResult<AdminOrderIssueDetail>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.read");
  if (!access.ok) return access;
  const row = await deps.db
    .prepare(
      `SELECT id, order_id AS orderId, category, status, details,
              assigned_staff_id AS assignedStaffId, resolution, version, created_at AS createdAt
       FROM order_issue WHERE id = ?`,
    )
    .bind(request.issueId)
    .first<{
      id: string;
      orderId: string;
      category: AdminOrderIssueDetail["category"];
      status: AdminOrderIssueDetail["status"];
      details: string | null;
      assignedStaffId: string | null;
      resolution: string | null;
      version: number;
      createdAt: number;
    }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order issue not found", requestId: request.requestId },
    };
  }
  return {
    ok: true,
    value: {
      issueId: row.id,
      orderId: row.orderId,
      category: row.category,
      status: row.status,
      details: row.details,
      assignedStaffId: row.assignedStaffId,
      resolution: row.resolution,
      version: row.version,
      createdAt: new Date(row.createdAt).toISOString(),
    },
    requestId: request.requestId,
  };
}
