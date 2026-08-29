import type {
  AdminCustomerDetail,
  AdminCustomerDetailRequest,
  AdminCustomerListRequest,
  AdminCustomerPage,
  AdminCustomerSummary,
  AdminAuditEventListItem,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  customerListLimit,
  decodeStaffCursor,
  encodeStaffCursor,
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";

type CustomerRow = {
  customerId: string;
  authUserId: string;
  email: string;
  phone: string | null;
  accessStatus: "active" | "disabled";
  subscriptionState: string | null;
  orderCount: number;
  lastOrderAt: number | null;
  version: number;
  createdAt: number;
};

const CUSTOMER_SELECT = `
  SELECT c.id AS customerId, c.auth_user_id AS authUserId, u.email AS email, c.phone,
         cp.status AS accessStatus, c.version, c.created_at AS createdAt,
         (SELECT s.status FROM subscription s WHERE s.customer_id = c.id
          ORDER BY s.created_at DESC LIMIT 1) AS subscriptionState,
         (SELECT COUNT(*) FROM grocery_order o
          WHERE o.customer_id = c.id AND o.status NOT IN ('DRAFT', 'PENDING_PAYMENT', 'EXPIRED')) AS orderCount,
         (SELECT MAX(o.created_at) FROM grocery_order o
          WHERE o.customer_id = c.id AND o.status NOT IN ('DRAFT', 'PENDING_PAYMENT', 'EXPIRED')) AS lastOrderAt
  FROM customer c
  JOIN customer_principal cp ON cp.id = c.principal_id
  JOIN user u ON u.id = c.auth_user_id`;

function toSummary(row: CustomerRow): AdminCustomerSummary {
  return {
    customerId: row.customerId,
    authUserId: row.authUserId,
    email: row.email,
    phone: row.phone,
    accessStatus: row.accessStatus,
    subscriptionState: row.subscriptionState,
    orderCount: row.orderCount,
    lastOrderAt: row.lastOrderAt === null ? null : new Date(row.lastOrderAt).toISOString(),
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Bounded keyset listing of customers for global customer readers. */
export async function listAdminCustomers(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerListRequest,
): Promise<RpcResult<AdminCustomerPage>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;

  const limit = customerListLimit(request.limit);
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
  const query = request.query?.trim() ?? "";
  if (query.length > 100) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "query is too long",
        requestId: request.requestId,
      },
    };
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (cursor) {
    clauses.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  if (query !== "") {
    clauses.push("u.email LIKE ?");
    binds.push(`%${query}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(`${CUSTOMER_SELECT} ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<CustomerRow>();

  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items = pageRows.map(toSummary);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeStaffCursor({ createdAt: last.createdAt, id: last.customerId }) : null;
  return { ok: true, value: { items, nextCursor }, requestId: request.requestId };
}

/** One composed customer detail for global customer readers. */
export async function getAdminCustomer(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerDetailRequest,
): Promise<RpcResult<AdminCustomerDetail>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;

  const row = await deps.db
    .prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`)
    .bind(request.customerId)
    .first<CustomerRow>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Customer not found", requestId: request.requestId },
    };
  }

  const auditRows = await deps.db
    .prepare(
      `SELECT id, occurred_at, actor_user_id, action, aggregate_type, aggregate_id,
              market_id, location_id, reason, correlation_id
       FROM audit_event WHERE actor_user_id = ?
       ORDER BY occurred_at DESC, id DESC LIMIT 10`,
    )
    .bind(row.authUserId)
    .all<{
      id: string;
      occurred_at: number;
      actor_user_id: string | null;
      action: string;
      aggregate_type: string;
      aggregate_id: string;
      market_id: string | null;
      location_id: string | null;
      reason: string | null;
      correlation_id: string | null;
    }>();
  const recentAudit: AdminAuditEventListItem[] = auditRows.results.map((audit) => ({
    auditEventId: audit.id,
    occurredAt: new Date(audit.occurred_at).toISOString(),
    actorId: audit.actor_user_id,
    action: audit.action,
    resourceType: audit.aggregate_type,
    resourceId: audit.aggregate_id,
    marketId: audit.market_id,
    locationId: audit.location_id,
    reason: audit.reason,
    correlationId: audit.correlation_id,
  }));

  const detail: AdminCustomerDetail = { ...toSummary(row), recentAudit };
  return { ok: true, value: detail, requestId: request.requestId };
}
