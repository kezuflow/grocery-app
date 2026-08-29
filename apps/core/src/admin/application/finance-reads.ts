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
  AdminPaymentDetail,
  AdminPaymentDetailRequest,
  AdminPaymentOverview,
  AdminPaymentPage,
  AdminPaymentSummary,
  AdminReconciliationCaseView,
  AdminReconciliationListRequest,
  AdminReconciliationPage,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  canTransitionOrder,
  orderLifecycleStates,
  type OrderLifecycleState,
} from "../../orders/domain/order-state-machine";
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
         (SELECT d.status FROM delivery_job d WHERE d.order_id = o.id LIMIT 1) AS deliveryStatus,
         EXISTS (SELECT 1 FROM order_payment_reaction opr WHERE opr.order_id = o.id) AS hasPaymentReaction,
         (SELECT ofs.cutoff_at FROM order_fulfillment_snapshot ofs WHERE ofs.order_id = o.id LIMIT 1) AS cutoffAt
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
  requiredCapability: "orders.read" | "orders.manage" = "orders.read",
): Promise<RpcResult<AdminOrderDetail>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, requiredCapability);
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
    hasPaymentReaction: number;
    cutoffAt: number | null;
  }>();
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: request.requestId },
    };
  }

  const items = await deps.db
    .prepare(
      `SELECT product_name_snapshot AS productName, variant_name_snapshot AS variantName,
              unit_snapshot AS unit, quantity, base_quantity AS baseQuantity,
              unit_price_minor AS unitPriceMinor, line_total_minor AS lineTotalMinor
       FROM order_item WHERE order_id = ?`,
    )
    .bind(request.orderId)
    .all<{
      productName: string;
      variantName: string;
      unit: string;
      quantity: number;
      baseQuantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }>();

  const quote = await deps.db
    .prepare(
      `SELECT q.subtotal_minor AS subtotalMinor, q.discount_minor AS discountMinor,
              q.delivery_fee_minor AS deliveryFeeMinor, q.total_minor AS totalMinor, q.currency
       FROM order_payment_reaction opr
       JOIN payment_intent pi ON pi.id=opr.payment_intent_id
       JOIN checkout_quote q ON pi.subject_type='checkout_quote' AND q.id=pi.subject_id
       WHERE opr.order_id=? LIMIT 1`,
    )
    .bind(request.orderId)
    .first<{
      subtotalMinor: number;
      discountMinor: number;
      deliveryFeeMinor: number;
      totalMinor: number;
      currency: string;
    }>();

  const payments = await deps.db
    .prepare(
      `SELECT DISTINCT pi.id AS paymentIntentId, pi.purpose, pi.status,
              pi.amount_minor AS amountMinor, pi.currency, pi.created_at AS createdAt,
              (SELECT COALESCE(SUM(pr.amount_minor),0) FROM payment_refund pr
               WHERE pr.payment_intent_id=pi.id AND pr.status='SUCCEEDED') AS refundedMinor
       FROM payment_intent pi
       WHERE pi.id IN (
         SELECT payment_intent_id FROM order_payment_reaction WHERE order_id=?
         UNION SELECT payment_intent_id FROM paid_order_amendment
               WHERE order_id=? AND payment_intent_id IS NOT NULL
       ) ORDER BY pi.created_at DESC`,
    )
    .bind(request.orderId, request.orderId)
    .all<{
      paymentIntentId: string;
      purpose: string;
      status: string;
      amountMinor: number;
      currency: string;
      createdAt: number;
      refundedMinor: number;
    }>();

  const amendmentRows = await deps.db
    .prepare(
      `SELECT id, status, total_minor AS totalMinor, currency,
              payment_intent_id AS paymentIntentId, created_at AS createdAt, updated_at AS updatedAt
       FROM paid_order_amendment WHERE order_id=? ORDER BY created_at DESC`,
    )
    .bind(request.orderId)
    .all<{
      id: string;
      status: string;
      totalMinor: number;
      currency: string;
      paymentIntentId: string | null;
      createdAt: number;
      updatedAt: number;
    }>();
  const amendments = await Promise.all(
    amendmentRows.results.map(async (amendment) => {
      const lines = await deps.db
        .prepare(
          `SELECT product_name_snapshot AS productName, variant_name_snapshot AS variantName,
                  unit_snapshot AS unit, quantity, base_quantity AS baseQuantity,
                  unit_price_minor AS unitPriceMinor, line_total_minor AS lineTotalMinor
           FROM paid_order_amendment_line WHERE amendment_id=? ORDER BY created_at, id`,
        )
        .bind(amendment.id)
        .all<{
          productName: string;
          variantName: string;
          unit: string;
          quantity: number;
          baseQuantity: number;
          unitPriceMinor: number;
          lineTotalMinor: number;
        }>();
      return {
        amendmentId: amendment.id,
        status: amendment.status,
        totalMinor: amendment.totalMinor,
        currency: amendment.currency,
        paymentIntentId: amendment.paymentIntentId,
        createdAt: new Date(amendment.createdAt).toISOString(),
        updatedAt: new Date(amendment.updatedAt).toISOString(),
        lines: lines.results,
      };
    }),
  );

  const fulfillment = await deps.db
    .prepare(
      `SELECT ofs.location_id AS locationId, ofs.cycle_id AS cycleId, ofs.zone_id AS zoneId,
              ofs.fulfillment_mode AS fulfillmentMode, ofs.cutoff_at AS cutoffAt,
              ofs.delivery_date AS deliveryDate, ofs.promised_at AS promisedAt,
              ofs.sourcing_modes_json AS sourcingModesJson, f.status,
              f.version, f.updated_at AS updatedAt
       FROM order_fulfillment_snapshot ofs
       LEFT JOIN fulfillment_record f ON f.order_id=ofs.order_id WHERE ofs.order_id=?`,
    )
    .bind(request.orderId)
    .first<{
      locationId: string;
      cycleId: string | null;
      zoneId: string | null;
      fulfillmentMode: string;
      cutoffAt: number | null;
      deliveryDate: number | null;
      promisedAt: number | null;
      sourcingModesJson: string;
      status: string | null;
      version: number | null;
      updatedAt: number | null;
    }>();

  const delivery = await deps.db
    .prepare(
      `SELECT id, status, rider_user_id AS riderUserId, version, delivered_at AS deliveredAt,
              created_at AS createdAt, updated_at AS updatedAt
       FROM delivery_job WHERE order_id=?`,
    )
    .bind(request.orderId)
    .first<{
      id: string;
      status: string;
      riderUserId: string | null;
      version: number;
      deliveredAt: number | null;
      createdAt: number;
      updatedAt: number;
    }>();

  const financeExceptions = await deps.db
    .prepare(
      `SELECT id, kind, status, last_error_code AS details, created_at AS createdAt,
              resolved_at AS resolvedAt FROM finance_exception WHERE order_id=?`,
    )
    .bind(request.orderId)
    .all<{
      id: string;
      kind: string;
      status: string;
      details: string | null;
      createdAt: number;
      resolvedAt: number | null;
    }>();
  const orderIssues = await deps.db
    .prepare(
      `SELECT id, category AS kind, status, details, created_at AS createdAt,
              CASE WHEN status='RESOLVED' THEN updated_at ELSE NULL END AS resolvedAt
       FROM order_issue WHERE order_id=?`,
    )
    .bind(request.orderId)
    .all<{
      id: string;
      kind: string;
      status: string;
      details: string | null;
      createdAt: number;
      resolvedAt: number | null;
    }>();

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
    allowedActions: access.value.capabilities.includes("orders.manage")
      ? allowedOrderActions(row, Date.now())
      : [],
    financial: quote
      ? { ...quote, source: "CHECKOUT_QUOTE" }
      : {
          subtotalMinor: null,
          discountMinor: null,
          deliveryFeeMinor: null,
          totalMinor: row.totalMinor,
          currency: row.currency,
          source: "ORDER_TOTAL_ONLY",
        },
    items: items.results,
    payments: payments.results.map((payment) => ({
      ...payment,
      createdAt: new Date(payment.createdAt).toISOString(),
    })),
    amendments,
    fulfillment: fulfillment
      ? {
          locationId: fulfillment.locationId,
          cycleId: fulfillment.cycleId,
          zoneId: fulfillment.zoneId,
          fulfillmentMode: fulfillment.fulfillmentMode,
          cutoffAt: toOptionalIso(fulfillment.cutoffAt),
          deliveryDate: toOptionalDate(fulfillment.deliveryDate),
          promisedAt: toOptionalIso(fulfillment.promisedAt),
          sourcingModes: parseStringArray(fulfillment.sourcingModesJson),
          status: fulfillment.status,
          version: fulfillment.version,
          updatedAt: toOptionalIso(fulfillment.updatedAt),
        }
      : null,
    delivery: delivery
      ? {
          deliveryJobId: delivery.id,
          status: delivery.status,
          riderUserId: delivery.riderUserId,
          version: delivery.version,
          deliveredAt: toOptionalIso(delivery.deliveredAt),
          createdAt: new Date(delivery.createdAt).toISOString(),
          updatedAt: new Date(delivery.updatedAt).toISOString(),
        }
      : null,
    exceptions: [
      ...financeExceptions.results.map((exception) => ({
        exceptionId: exception.id,
        source: "FINANCE" as const,
        kind: exception.kind,
        status: exception.status,
        details: exception.details,
        createdAt: new Date(exception.createdAt).toISOString(),
        resolvedAt: toOptionalIso(exception.resolvedAt),
      })),
      ...orderIssues.results.map((issue) => ({
        exceptionId: issue.id,
        source: "ORDER_ISSUE" as const,
        kind: issue.kind,
        status: issue.status,
        details: issue.details,
        createdAt: new Date(issue.createdAt).toISOString(),
        resolvedAt: toOptionalIso(issue.resolvedAt),
      })),
    ],
    timeline: buildOrderTimeline(
      row,
      payments.results,
      amendments,
      fulfillment,
      delivery,
      auditRows.results,
    ),
    recentAudit: auditRows.results.map((audit) => ({
      auditEventId: audit.id,
      occurredAt: new Date(audit.occurredAt).toISOString(),
      action: audit.action,
      reason: audit.reason,
    })),
  };
  return { ok: true, value: detail, requestId: request.requestId };
}

function toOptionalIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toOptionalDate(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString().slice(0, 10);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function buildOrderTimeline(
  order: { orderId: string; status: string; committedAt: number },
  payments: ReadonlyArray<{ paymentIntentId: string; status: string; createdAt: number }>,
  amendments: AdminOrderDetail["amendments"],
  fulfillment: { status: string | null; updatedAt: number | null } | null,
  delivery: { id: string; status: string; updatedAt: number } | null,
  audits: ReadonlyArray<{ id: string; occurredAt: number; action: string }>,
): AdminOrderDetail["timeline"] {
  return [
    {
      eventId: `order:${order.orderId}`,
      kind: "ORDER" as const,
      label: "Order committed",
      status: order.status,
      occurredAt: new Date(order.committedAt).toISOString(),
      referenceId: order.orderId,
    },
    ...payments.map((payment) => ({
      eventId: `payment:${payment.paymentIntentId}`,
      kind: "PAYMENT" as const,
      label: "Payment intent",
      status: payment.status,
      occurredAt: new Date(payment.createdAt).toISOString(),
      referenceId: payment.paymentIntentId,
    })),
    ...amendments.map((amendment) => ({
      eventId: `amendment:${amendment.amendmentId}`,
      kind: "AMENDMENT" as const,
      label: "Order amendment",
      status: amendment.status,
      occurredAt: amendment.createdAt,
      referenceId: amendment.amendmentId,
    })),
    ...(fulfillment?.updatedAt
      ? [
          {
            eventId: `fulfillment:${order.orderId}`,
            kind: "FULFILLMENT" as const,
            label: "Fulfillment updated",
            status: fulfillment.status,
            occurredAt: new Date(fulfillment.updatedAt).toISOString(),
            referenceId: order.orderId,
          },
        ]
      : []),
    ...(delivery
      ? [
          {
            eventId: `delivery:${delivery.id}`,
            kind: "DELIVERY" as const,
            label: "Delivery updated",
            status: delivery.status,
            occurredAt: new Date(delivery.updatedAt).toISOString(),
            referenceId: delivery.id,
          },
        ]
      : []),
    ...audits.map((audit) => ({
      eventId: `audit:${audit.id}`,
      kind: "AUDIT" as const,
      label: audit.action,
      status: null,
      occurredAt: new Date(audit.occurredAt).toISOString(),
      referenceId: audit.id,
    })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function allowedOrderActions(
  order: { status: string; hasPaymentReaction: number; cutoffAt: number | null },
  now: number,
): AdminOrderDetail["allowedActions"] {
  if (!orderLifecycleStates.includes(order.status as OrderLifecycleState)) return [];
  const current = order.status as OrderLifecycleState;
  if (!order.hasPaymentReaction) return canTransitionOrder(current, "CANCELED") ? ["CANCEL"] : [];
  if (order.cutoffAt !== null && order.cutoffAt <= now) return [];
  return canTransitionOrder(current, "CANCELLATION_REQUESTED") ? ["CANCEL"] : [];
}

const PAYMENT_SELECT = `
  SELECT pi.id AS paymentIntentId, pi.purpose, u.email AS customerEmail,
         pi.amount_minor AS amountMinor, pi.currency, pi.status,
         pi.created_at AS createdAt,
         (SELECT COALESCE(SUM(r.amount_minor), 0) FROM payment_refund r
          WHERE r.payment_intent_id = pi.id AND r.status = 'SUCCEEDED') AS refundedMinor,
         (SELECT COALESCE(SUM(r.amount_minor), 0) FROM payment_refund r
          WHERE r.payment_intent_id = pi.id
            AND r.status IN ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED')) AS reservedRefundMinor
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
      reservedRefundMinor: number;
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

/** Finance landing metrics derived from canonical payment and refund state. */
export async function getAdminPaymentOverview(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AuthenticatedRequest,
): Promise<RpcResult<AdminPaymentOverview>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.read");
  if (!access.ok) return access;

  const counts = await deps.db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='REQUIRES_ACTION' THEN 1 ELSE 0 END) AS actionRequired,
              SUM(CASE WHEN status IN ('INITIATED','PROCESSING') THEN 1 ELSE 0 END) AS processing,
              SUM(CASE WHEN status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status IN ('FAILED','EXPIRED') THEN 1 ELSE 0 END) AS failed
       FROM payment_intent`,
    )
    .first<{
      total: number;
      actionRequired: number;
      processing: number;
      succeeded: number;
      failed: number;
    }>();
  const openCases = await deps.db
    .prepare("SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE status='OPEN'")
    .first<{ count: number }>();
  const pendingRefunds = await deps.db
    .prepare(
      "SELECT COUNT(*) AS count FROM payment_refund WHERE status IN ('REQUESTED','APPROVED','PROCESSING')",
    )
    .first<{ count: number }>();
  const totals = await deps.db
    .prepare(
      `SELECT pi.currency,
              SUM(CASE WHEN pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
                       THEN pi.amount_minor ELSE 0 END) AS succeededMinor,
              COALESCE((SELECT SUM(pr.amount_minor) FROM payment_refund pr
                        JOIN payment_intent inner_pi ON inner_pi.id=pr.payment_intent_id
                        WHERE inner_pi.currency=pi.currency AND pr.status='SUCCEEDED'),0) AS refundedMinor
       FROM payment_intent pi GROUP BY pi.currency ORDER BY pi.currency`,
    )
    .all<{ currency: string; succeededMinor: number; refundedMinor: number }>();
  const recent = await listAdminPayments(deps, { ...request, limit: 10 });
  if (!recent.ok) return recent;

  return {
    ok: true,
    value: {
      intentCounts: {
        total: counts?.total ?? 0,
        actionRequired: counts?.actionRequired ?? 0,
        processing: counts?.processing ?? 0,
        succeeded: counts?.succeeded ?? 0,
        failed: counts?.failed ?? 0,
      },
      openReconciliationCount: openCases?.count ?? 0,
      pendingRefundCount: pendingRefunds?.count ?? 0,
      totalsByCurrency: totals.results,
      recentTransactions: recent.value.items,
    },
    requestId: request.requestId,
  };
}

/** One payment intent's operational workspace with provider-safe projections. */
export async function getAdminPayment(
  deps: FinanceAdministrationDeps,
  request: AdminPaymentDetailRequest,
): Promise<RpcResult<AdminPaymentDetail>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.read");
  if (!access.ok) return access;
  const row = await deps.db
    .prepare(`${PAYMENT_SELECT} WHERE pi.id=?`)
    .bind(request.paymentIntentId)
    .first<{
      paymentIntentId: string;
      purpose: string;
      customerEmail: string | null;
      amountMinor: number;
      currency: string;
      status: string;
      createdAt: number;
      refundedMinor: number;
      reservedRefundMinor: number;
    }>();
  const intent = await deps.db
    .prepare(
      `SELECT subject_type AS subjectType, subject_id AS subjectId, version,
              updated_at AS updatedAt FROM payment_intent WHERE id=?`,
    )
    .bind(request.paymentIntentId)
    .first<{ subjectType: string; subjectId: string; version: number; updatedAt: number }>();
  if (!row || !intent) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Payment not found", requestId: request.requestId },
    };
  }

  const attempts = await deps.db
    .prepare(
      `SELECT id, provider, status, amount_minor AS amountMinor, currency,
              created_at AS createdAt, updated_at AS updatedAt
       FROM payment_attempt WHERE payment_intent_id=? ORDER BY created_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      provider: string;
      status: string;
      amountMinor: number;
      currency: string;
      createdAt: number;
      updatedAt: number;
    }>();
  const refunds = await deps.db
    .prepare(
      `SELECT id, amount_minor AS amountMinor, currency, status, reason, created_at AS createdAt
       FROM payment_refund WHERE payment_intent_id=? ORDER BY created_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      amountMinor: number;
      currency: string;
      status: string;
      reason: string | null;
      createdAt: number;
    }>();
  const events = await deps.db
    .prepare(
      `SELECT DISTINCT pe.id, pe.provider, pe.event_type AS eventType,
              pe.processing_status AS processingStatus, pe.received_at AS receivedAt,
              pe.processed_at AS processedAt
       FROM payment_events pe JOIN payment_attempt pa
         ON pa.payment_intent_id=? AND pa.provider=pe.provider
        AND pa.provider_reference=pe.provider_reference
       ORDER BY pe.received_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      provider: string;
      eventType: string;
      processingStatus: string;
      receivedAt: number;
      processedAt: number | null;
    }>();
  const reactions = await deps.db
    .prepare(
      `SELECT id, reaction_type AS reactionType, subject_type AS subjectType,
              subject_id AS subjectId, status, attempts, last_error_code AS lastErrorCode,
              COALESCE(available_at, created_at) AS availableAt, updated_at AS updatedAt
       FROM payment_reaction WHERE payment_intent_id=? ORDER BY created_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      reactionType: string;
      subjectType: string;
      subjectId: string;
      status: string;
      attempts: number;
      lastErrorCode: string | null;
      availableAt: number;
      updatedAt: number;
    }>();
  const cases = await deps.db
    .prepare(
      `SELECT id, category, status, created_at AS createdAt, resolved_at AS resolvedAt
       FROM payment_reconciliation_case WHERE payment_intent_id=? ORDER BY created_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      category: import("@freshmarkets/contracts").ReconciliationCaseCategory;
      status: "OPEN" | "RESOLVED";
      createdAt: number;
      resolvedAt: number | null;
    }>();
  const auditRows = await deps.db
    .prepare(
      `SELECT id, occurred_at AS occurredAt, action, reason FROM audit_event
       WHERE aggregate_type IN ('payment','payment_intent') AND aggregate_id=?
       ORDER BY occurred_at DESC, id DESC LIMIT 10`,
    )
    .bind(request.paymentIntentId)
    .all<{ id: string; occurredAt: number; action: string; reason: string | null }>();
  const remainingRefundableMinor = Math.max(0, row.amountMinor - row.reservedRefundMinor);
  const refundable = ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(row.status);

  return {
    ok: true,
    value: {
      paymentIntentId: row.paymentIntentId,
      purpose: row.purpose,
      subjectType: intent.subjectType,
      subjectId: intent.subjectId,
      customerEmail: row.customerEmail ?? "—",
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      refundedMinor: row.refundedMinor,
      remainingRefundableMinor,
      version: intent.version,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(intent.updatedAt).toISOString(),
      allowedActions:
        access.value.capabilities.includes("refunds.manage") &&
        refundable &&
        remainingRefundableMinor > 0
          ? ["REQUEST_REFUND"]
          : [],
      attempts: attempts.results.map((attempt) => ({
        attemptId: attempt.id,
        provider: attempt.provider,
        status: attempt.status,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        createdAt: new Date(attempt.createdAt).toISOString(),
        updatedAt: new Date(attempt.updatedAt).toISOString(),
      })),
      refunds: refunds.results.map((refund) => ({
        refundId: refund.id,
        paymentIntentId: request.paymentIntentId,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        status: refund.status,
        reason: refund.reason,
        createdAt: new Date(refund.createdAt).toISOString(),
      })),
      events: events.results.map((event) => ({
        eventId: event.id,
        provider: event.provider,
        eventType: event.eventType,
        processingStatus: event.processingStatus,
        receivedAt: new Date(event.receivedAt).toISOString(),
        processedAt: toOptionalIso(event.processedAt),
      })),
      reactions: reactions.results.map((reaction) => ({
        reactionId: reaction.id,
        reactionType: reaction.reactionType,
        subjectType: reaction.subjectType,
        subjectId: reaction.subjectId,
        status: reaction.status,
        attempts: reaction.attempts,
        lastErrorCode: reaction.lastErrorCode,
        availableAt: new Date(reaction.availableAt).toISOString(),
        processedAt:
          reaction.status === "SUCCEEDED" ? new Date(reaction.updatedAt).toISOString() : null,
      })),
      reconciliationCases: cases.results.map((item) => ({
        caseId: item.id,
        paymentIntentId: request.paymentIntentId,
        category: item.category,
        status: item.status,
        createdAt: new Date(item.createdAt).toISOString(),
        resolvedAt: toOptionalIso(item.resolvedAt),
      })),
      recentAudit: auditRows.results.map((audit) => ({
        auditEventId: audit.id,
        occurredAt: new Date(audit.occurredAt).toISOString(),
        action: audit.action,
        reason: audit.reason,
      })),
    },
    requestId: request.requestId,
  };
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
              created_at AS createdAt, resolved_at AS resolvedAt
       FROM payment_reconciliation_case ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      paymentIntentId: string | null;
      category: AdminReconciliationCaseView["category"];
      status: "OPEN" | "RESOLVED";
      createdAt: number;
      resolvedAt: number | null;
    }>();
  const hasMore = rows.results.length > limit;
  const items: AdminReconciliationCaseView[] = rows.results.slice(0, limit).map((row) => ({
    caseId: row.id,
    paymentIntentId: row.paymentIntentId,
    category: row.category,
    status: row.status,
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
