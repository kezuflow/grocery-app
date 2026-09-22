import { readPaymentReactionRecovery } from "../../payments/application/read-payment-reaction-recovery";
import { readProviderEventRecovery } from "../../payments/application/read-provider-event-recovery";
import {
  reconciliationResolutionEvidence,
  refundedCommitmentResolutionEvidence,
  unresolvedReconciliationReason,
} from "../../payments/infrastructure/d1/reconciliation-resolution";
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
  AdminOrderIssueSummary,
  AdminOrderIssueView,
  AdminOrderListRequest,
  AdminOrderPage,
  AdminOrderSummary,
  AdminPaymentListRequest,
  AdminPaymentAttentionListRequest,
  AdminPaymentAttentionPage,
  AdminPaymentAttentionItem,
  AdminPaymentDetail,
  AdminPaymentDetailRequest,
  AdminPaymentPage,
  AdminPaymentSummary,
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
import { allowedOrderIssueActions } from "./order-issue-policy";

const PAYMENT_ATTENTION_CASE_PREDICATE = `payment_reconciliation_case.status='OPEN'
  AND NOT ((${reconciliationResolutionEvidence}) OR (${refundedCommitmentResolutionEvidence}))
  AND (
    payment_reconciliation_case.id='payment-lookup:'||payment_reconciliation_case.payment_intent_id
    OR payment_reconciliation_case.category IN ('UNMAPPED_PROVIDER_REFERENCE','AMBIGUOUS_OUTCOME','PROVIDER_TIMEOUT','REACTION_FAILURE','REFUND_UNRESOLVED')
  )`;

const PAYMENT_ATTENTION_CTE = `WITH attention_cases AS (
  SELECT payment_reconciliation_case.*,
    CASE
      WHEN payment_reconciliation_case.payment_intent_id IS NOT NULL THEN 'payment:'||payment_reconciliation_case.payment_intent_id
      WHEN json_valid(payment_reconciliation_case.details_json) AND json_extract(payment_reconciliation_case.details_json,'$.providerEventId') IS NOT NULL
        THEN 'event:'||COALESCE(json_extract(payment_reconciliation_case.details_json,'$.provider'),'unknown')||':'||json_extract(payment_reconciliation_case.details_json,'$.providerEventId')
      ELSE 'case:'||payment_reconciliation_case.id
    END AS group_key
  FROM payment_reconciliation_case
  WHERE ${PAYMENT_ATTENTION_CASE_PREDICATE}
), attention_groups AS (
  SELECT group_key,MAX(payment_intent_id) payment_intent_id,MIN(created_at) opened_at,
    GROUP_CONCAT(id) case_ids,GROUP_CONCAT(category) categories
  FROM attention_cases GROUP BY group_key
)`;

function attentionProblem(categories: string): string {
  const values = new Set(categories.split(","));
  if (values.has("REACTION_FAILURE"))
    return "Payment received, but Order confirmation needs recovery";
  if (values.has("REFUND_UNRESOLVED"))
    return "Refund confirmation or required local updates need recovery";
  if (values.has("UNMAPPED_PROVIDER_REFERENCE"))
    return "Provider payment evidence could not be matched";
  if (values.has("PROVIDER_TIMEOUT")) return "Provider outcome remains unknown after recovery";
  return "Payment outcome requires verified recovery";
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toOrderCustomer(addressSnapshotJson: string, email: string): AdminOrderDetail["customer"] {
  const snapshot = parseRecord(addressSnapshotJson);
  const address = parseRecord(snapshot.address_json ?? snapshot.components);
  const addressLines = [
    nonEmptyString(address.addressLine1 ?? snapshot.addressLine1),
    nonEmptyString(address.addressLine2 ?? snapshot.addressLine2),
    nonEmptyString(address.barangay ?? snapshot.barangay),
    nonEmptyString(address.city ?? snapshot.city),
    nonEmptyString(address.region ?? snapshot.region),
    nonEmptyString(address.postalCode ?? snapshot.postalCode),
  ].filter((part): part is string => part !== null);
  return {
    name: nonEmptyString(snapshot.recipient),
    email,
    phone: nonEmptyString(snapshot.phone),
    addressLines,
  };
}

const ORDER_SELECT = `
  SELECT o.id AS orderId, o.order_number AS orderNumber,
         o.address_snapshot_json AS addressSnapshotJson,
         u.email AS customerEmail, o.fulfillment_mode AS fulfillmentMode,
         o.status, o.total_minor AS totalMinor,
         o.currency, COALESCE(o.committed_at, o.created_at) AS committedAt, o.version,
         (SELECT pi.status FROM order_payment_reaction opr
          JOIN payment_intent pi ON pi.id = opr.payment_intent_id
          WHERE opr.order_id = o.id ORDER BY pi.created_at DESC LIMIT 1) AS paymentStatus,
         (SELECT f.status FROM fulfillment_record f WHERE f.order_id = o.id LIMIT 1) AS fulfillmentStatus,
         delivery.status AS deliveryStatus,
         latest_dispatch.status AS deliveryDispatchStatus,
         latest_dispatch.provider_status AS deliveryProviderStatus,
         EXISTS (SELECT 1 FROM order_payment_reaction opr WHERE opr.order_id = o.id) AS hasPaymentReaction,
         (SELECT ofs.cutoff_at FROM order_fulfillment_snapshot ofs WHERE ofs.order_id = o.id LIMIT 1) AS cutoffAt
  FROM grocery_order o JOIN customer c ON c.id = o.customer_id JOIN user u ON u.id = c.auth_user_id
  LEFT JOIN delivery_job delivery ON delivery.order_id=o.id
  LEFT JOIN delivery_provider_dispatch latest_dispatch ON latest_dispatch.id=(
    SELECT candidate.id FROM delivery_provider_dispatch candidate
    WHERE candidate.delivery_job_id=delivery.id ORDER BY candidate.attempt_sequence DESC LIMIT 1
  )`;

function toOrderSummary(row: {
  orderId: string;
  orderNumber: string | null;
  addressSnapshotJson: string;
  customerEmail: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  status: string;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  deliveryDispatchStatus: string | null;
  deliveryProviderStatus: string | null;
  committedAt: number;
  version: number;
}): AdminOrderSummary {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerName: toOrderCustomer(row.addressSnapshotJson, row.customerEmail).name,
    customerEmail: row.customerEmail,
    fulfillmentMode: row.fulfillmentMode,
    status: row.status,
    totalMinor: row.totalMinor,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    deliveryStatus: row.deliveryStatus,
    deliveryDispatchStatus: row.deliveryDispatchStatus,
    deliveryProviderStatus: row.deliveryProviderStatus,
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
  if (request.status !== undefined) {
    clauses.push("o.status = ?");
    binds.push(request.status);
  }
  if (cursor) {
    clauses.push(
      "(COALESCE(o.committed_at,o.created_at) < ? OR (COALESCE(o.committed_at,o.created_at) = ? AND o.id < ?))",
    );
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `${ORDER_SELECT} ${where} ORDER BY COALESCE(o.committed_at,o.created_at) DESC, o.id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      orderId: string;
      orderNumber: string | null;
      addressSnapshotJson: string;
      customerEmail: string;
      fulfillmentMode: "INSTANT" | "SCHEDULED";
      status: string;
      totalMinor: number;
      currency: string;
      paymentStatus: string | null;
      fulfillmentStatus: string | null;
      deliveryStatus: string | null;
      deliveryDispatchStatus: string | null;
      deliveryProviderStatus: string | null;
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
    orderNumber: string | null;
    addressSnapshotJson: string;
    customerEmail: string;
    fulfillmentMode: "INSTANT" | "SCHEDULED";
    status: string;
    totalMinor: number;
    currency: string;
    paymentStatus: string | null;
    fulfillmentStatus: string | null;
    deliveryStatus: string | null;
    deliveryDispatchStatus: string | null;
    deliveryProviderStatus: string | null;
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
              q.delivery_fee_minor AS deliveryFeeMinor,
              q.service_fee_minor AS serviceFeeMinor, q.tax_minor AS taxMinor,
              q.total_minor AS totalMinor, q.currency
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
      serviceFeeMinor: number;
      taxMinor: number;
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
    customer: toOrderCustomer(row.addressSnapshotJson, row.customerEmail),
    financial: quote
      ? { ...quote, source: "CHECKOUT_QUOTE" }
      : {
          subtotalMinor: null,
          discountMinor: null,
          deliveryFeeMinor: null,
          serviceFeeMinor: null,
          taxMinor: null,
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
  SELECT pi.id AS paymentIntentId, pi.purpose, u.name AS customerName, u.email AS customerEmail,
         CASE WHEN c.status='closed' OR u.id IS NULL THEN 1 ELSE 0 END AS deletedCustomer,
         COALESCE(
           (SELECT link.order_id FROM order_payment_reaction link WHERE link.payment_intent_id=pi.id LIMIT 1),
           (SELECT amendment.order_id FROM paid_order_amendment amendment WHERE amendment.payment_intent_id=pi.id LIMIT 1),
           (SELECT orders.id FROM grocery_order orders JOIN payment_attempt attempt ON attempt.id=orders.payment_id WHERE attempt.payment_intent_id=pi.id LIMIT 1)
         ) AS orderId,
         COALESCE(
           (SELECT orders.order_number FROM order_payment_reaction link JOIN grocery_order orders ON orders.id=link.order_id WHERE link.payment_intent_id=pi.id LIMIT 1),
           (SELECT orders.order_number FROM paid_order_amendment amendment JOIN grocery_order orders ON orders.id=amendment.order_id WHERE amendment.payment_intent_id=pi.id LIMIT 1),
           (SELECT orders.order_number FROM grocery_order orders JOIN payment_attempt attempt ON attempt.id=orders.payment_id WHERE attempt.payment_intent_id=pi.id LIMIT 1)
         ) AS orderNumber,
         pi.amount_minor AS amountMinor, pi.currency, pi.status,
         pi.created_at AS createdAt,
         (SELECT COALESCE(SUM(r.amount_minor), 0) FROM payment_refund r
          WHERE r.payment_intent_id = pi.id AND r.status = 'SUCCEEDED') AS refundedMinor,
         (SELECT COALESCE(SUM(r.amount_minor), 0) FROM payment_refund r
          WHERE r.payment_intent_id = pi.id
            AND r.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED')) AS reservedRefundMinor
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

  const clauses: string[] = ["pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')"];
  const binds: unknown[] = [];
  if (request.status !== undefined) {
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
      customerName: string | null;
      customerEmail: string | null;
      deletedCustomer: number;
      orderId: string | null;
      orderNumber: string | null;
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
    customerName: row.deletedCustomer ? "Deleted customer" : row.customerName,
    customerEmail: row.deletedCustomer ? "Deleted customer" : (row.customerEmail ?? "—"),
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status as AdminPaymentSummary["status"],
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
      customerName: string | null;
      customerEmail: string | null;
      deletedCustomer: number;
      orderId: string | null;
      orderNumber: string | null;
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
      `SELECT id, amount_minor AS amountMinor, currency, status, reason, created_at AS createdAt,version,attempt_count,next_retry_at,last_error_code,processing_started_at
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
      version: number;
      attempt_count: number;
      next_retry_at: number | null;
      last_error_code: string | null;
      processing_started_at: number | null;
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
      `SELECT id, category, status, created_at AS createdAt, resolved_at AS resolvedAt,version,(${reconciliationResolutionEvidence}) eligible,(${refundedCommitmentResolutionEvidence}) refundedCommitment
       FROM payment_reconciliation_case WHERE payment_intent_id=? ORDER BY created_at DESC`,
    )
    .bind(request.paymentIntentId)
    .all<{
      id: string;
      version: number;
      eligible: number;
      refundedCommitment: number;
      category: import("@freshmarkets/contracts").ReconciliationCaseCategory;
      status: "OPEN" | "RESOLVED";
      createdAt: number;
      resolvedAt: number | null;
    }>();
  const auditRows = await deps.db
    .prepare(
      `SELECT id, occurred_at AS occurredAt, action, reason FROM audit_event
       WHERE (aggregate_type IN ('payment','payment_intent') AND aggregate_id=?) OR (aggregate_type='payment_refund' AND aggregate_id IN (SELECT id FROM payment_refund WHERE payment_intent_id=?))
       ORDER BY occurred_at DESC, id DESC LIMIT 10`,
    )
    .bind(request.paymentIntentId, request.paymentIntentId)
    .all<{ id: string; occurredAt: number; action: string; reason: string | null }>();
  const refundable = ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(row.status);
  const remainingRefundableMinor = refundable
    ? Math.max(0, row.amountMinor - row.reservedRefundMinor)
    : 0;
  const activeCancellation = await deps.db
    .prepare(`SELECT 1 FROM order_cancellation_refund_member member
    JOIN order_cancellation cancellation ON cancellation.id=member.cancellation_id
    WHERE member.payment_intent_id=? AND cancellation.status!='COMPLETED' LIMIT 1`)
    .bind(request.paymentIntentId)
    .first();
  const capturedAttempt = await deps.db
    .prepare(
      "SELECT provider,provider_reference FROM payment_attempt WHERE payment_intent_id=? AND status='SUCCEEDED' ORDER BY created_at DESC,id LIMIT 1",
    )
    .bind(request.paymentIntentId)
    .first<{ provider: string; provider_reference: string | null }>();
  const latestAttempt = await deps.db
    .prepare(
      "SELECT provider,provider_reference FROM payment_attempt WHERE payment_intent_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    .bind(request.paymentIntentId)
    .first<{ provider: string; provider_reference: string | null }>();
  const lookup = await deps.db
    .prepare(
      "SELECT status,attempts,available_at,lease_token,last_error_code,version FROM payment_lookup_recovery WHERE payment_intent_id=?",
    )
    .bind(request.paymentIntentId)
    .first<{
      status: "PENDING" | "COMPLETED" | "EXHAUSTED";
      attempts: number;
      available_at: number;
      lease_token: string | null;
      last_error_code: string | null;
      version: number;
    }>();
  const lookupRecovery: import("@freshmarkets/contracts").AdminPaymentLookupRecovery = {
    version: lookup?.version ?? 0,
    status: lookup?.status ?? "NOT_STARTED",
    attempts: lookup?.attempts ?? 0,
    nextCheckAt: lookup?.status === "PENDING" ? new Date(lookup.available_at).toISOString() : null,
    lastErrorCode: lookup?.last_error_code ?? null,
    canRecheck:
      access.value.capabilities.includes("payments.manage") &&
      ["INITIATED", "REQUIRES_ACTION", "PROCESSING"].includes(row.status) &&
      lookup?.status === "EXHAUSTED" &&
      Boolean(latestAttempt?.provider_reference && deps.payments?.get(latestAttempt.provider)) &&
      (!lookup?.lease_token || lookup.available_at <= Date.now()),
  };
  const refundUnavailableReason = !access.value.capabilities.includes("refunds.manage")
    ? "Global refund permission is required."
    : !refundable
      ? "This payment is not in a refundable state."
      : activeCancellation
        ? "The coordinated order cancellation owns this payment's refund. Review its progress."
        : remainingRefundableMinor === 0
          ? "The payment balance is already refunded or reserved by existing refunds."
          : !capturedAttempt?.provider_reference
            ? "Captured provider payment evidence is missing."
            : !deps.payments?.get(capturedAttempt.provider)
              ? "The captured payment provider is unavailable."
              : null;

  return {
    ok: true,
    value: {
      paymentIntentId: row.paymentIntentId,
      purpose: row.purpose,
      customerName: row.deletedCustomer ? "Deleted customer" : row.customerName,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      subjectType: intent.subjectType,
      subjectId: intent.subjectId,
      customerEmail: row.deletedCustomer ? "Deleted customer" : (row.customerEmail ?? "—"),
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      canonicalStatus: row.status,
      displayStatus: cases.results.some((item) => item.status === "OPEN" && !item.eligible)
        ? "PAYMENT_OUTCOME_UNKNOWN"
        : row.status === "REQUIRES_ACTION"
          ? lookup?.status === "COMPLETED"
            ? "PAYMENT_WINDOW_EXPIRED"
            : "AWAITING_PAYMENT"
          : row.status === "INITIATED" || row.status === "PROCESSING"
            ? "CONFIRMING_PAYMENT"
            : row.status === "SUCCEEDED"
              ? "PAID"
              : row.status === "PARTIALLY_REFUNDED"
                ? "PARTIALLY_REFUNDED"
                : row.status === "REFUNDED"
                  ? "REFUNDED"
                  : "PAYMENT_FAILED",
      refundedMinor: row.refundedMinor,
      remainingRefundableMinor,
      refundUnavailableReason,
      lookupRecovery,
      version: intent.version,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(intent.updatedAt).toISOString(),
      allowedActions: refundUnavailableReason === null ? ["REQUEST_REFUND"] : [],
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
        version: refund.version,
        recovery: {
          attempts: refund.attempt_count,
          nextCheckAt: refund.attempt_count >= 5 ? null : toOptionalIso(refund.next_retry_at),
          lastErrorCode: refund.last_error_code,
          canRecheck:
            access.value.capabilities.includes("refunds.manage") &&
            refund.processing_started_at === null &&
            refund.next_retry_at === null &&
            (refund.status === "ESCALATED" ||
              (["SUCCEEDED", "FAILED"].includes(refund.status) && refund.last_error_code !== null)),
        },
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
        resolutionAction: item.refundedCommitment ? "CONFIRM_REFUNDED_COMMITMENT" : "RESOLVE",
        version: item.version,
        resolutionUnavailableReason:
          item.status !== "OPEN"
            ? "Case is already resolved."
            : !access.value.capabilities.includes("refunds.manage")
              ? "Global refund permission is required."
              : item.eligible
                ? null
                : unresolvedReconciliationReason,
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

/** One oldest-first row per genuine unresolved payment or unmatched provider event. */
export async function listAdminPaymentAttention(
  deps: FinanceAdministrationDeps,
  request: AdminPaymentAttentionListRequest,
): Promise<RpcResult<AdminPaymentAttentionPage>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.read");
  if (!access.ok) return access;
  const limit = boundListLimit(request.limit);
  if (limit === "invalid")
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "limit must be an integer between 1 and 100",
        requestId: request.requestId,
      },
    };
  let cursor: { createdAt: number; id: string } | null = null;
  if (request.cursor !== undefined) {
    cursor = decodeStaffCursor(request.cursor);
    if (!cursor)
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "cursor is malformed",
          requestId: request.requestId,
        },
      };
  }
  const rows = await deps.db
    .prepare(`${PAYMENT_ATTENTION_CTE}
      SELECT groups.group_key groupKey,groups.payment_intent_id paymentIntentId,groups.opened_at openedAt,
        groups.case_ids caseIds,groups.categories,
        user.name customerName,user.email customerEmail,customer.status customerStatus,
        payment.amount_minor amountMinor,payment.currency
      FROM attention_groups groups
      LEFT JOIN payment_intent payment ON payment.id=groups.payment_intent_id
      LEFT JOIN customer ON customer.id=payment.customer_id
      LEFT JOIN user ON user.id=customer.auth_user_id
      WHERE (? IS NULL OR groups.opened_at>? OR (groups.opened_at=? AND groups.group_key>?))
      ORDER BY groups.opened_at,groups.group_key LIMIT ?`)
    .bind(
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? 0,
      cursor?.createdAt ?? 0,
      cursor?.id ?? "",
      limit + 1,
    )
    .all<{
      groupKey: string;
      paymentIntentId: string | null;
      openedAt: number;
      caseIds: string;
      categories: string;
      customerName: string | null;
      customerEmail: string | null;
      customerStatus: string | null;
      amountMinor: number | null;
      currency: string | null;
    }>();
  const count = await deps.db
    .prepare(`${PAYMENT_ATTENTION_CTE} SELECT COUNT(*) count FROM attention_groups`)
    .first<{ count: number }>();
  const pageRows = rows.results.slice(0, limit);
  const caseIds = [...new Set(pageRows.flatMap((row) => row.caseIds.split(",")))];
  const [caseRows, lookupRows, refundRows, providerRecoveries, reactionRecoveries] =
    await Promise.all([
      caseIds.length
        ? deps.db
            .prepare(
              `SELECT id,version,payment_intent_id paymentIntentId FROM payment_reconciliation_case WHERE id IN (${caseIds.map(() => "?").join(",")})`,
            )
            .bind(...caseIds)
            .all<{ id: string; version: number; paymentIntentId: string | null }>()
        : Promise.resolve({
            results: [] as { id: string; version: number; paymentIntentId: string | null }[],
          }),
      pageRows.some((row) => row.paymentIntentId)
        ? deps.db
            .prepare(`SELECT recovery.payment_intent_id paymentIntentId,recovery.status,recovery.version,
            recovery.available_at availableAt,recovery.lease_token leaseToken,payment.version paymentVersion
            FROM payment_lookup_recovery recovery JOIN payment_intent payment ON payment.id=recovery.payment_intent_id
            WHERE recovery.payment_intent_id IN (${pageRows
              .filter((row) => row.paymentIntentId)
              .map(() => "?")
              .join(",")})`)
            .bind(...pageRows.flatMap((row) => (row.paymentIntentId ? [row.paymentIntentId] : [])))
            .all<{
              paymentIntentId: string;
              status: string;
              version: number;
              availableAt: number;
              leaseToken: string | null;
              paymentVersion: number;
            }>()
        : Promise.resolve({
            results: [] as {
              paymentIntentId: string;
              status: string;
              version: number;
              availableAt: number;
              leaseToken: string | null;
              paymentVersion: number;
            }[],
          }),
      pageRows.some((row) => row.paymentIntentId)
        ? deps.db
            .prepare(`SELECT refund.id,refund.payment_intent_id paymentIntentId,refund.version,refund.status,
            refund.processing_started_at processingStartedAt,refund.next_retry_at nextRetryAt,refund.last_error_code lastErrorCode
            FROM payment_refund refund WHERE refund.payment_intent_id IN (${pageRows
              .filter((row) => row.paymentIntentId)
              .map(() => "?")
              .join(",")})`)
            .bind(...pageRows.flatMap((row) => (row.paymentIntentId ? [row.paymentIntentId] : [])))
            .all<{
              id: string;
              paymentIntentId: string;
              version: number;
              status: string;
              processingStartedAt: number | null;
              nextRetryAt: number | null;
              lastErrorCode: string | null;
            }>()
        : Promise.resolve({
            results: [] as {
              id: string;
              paymentIntentId: string;
              version: number;
              status: string;
              processingStartedAt: number | null;
              nextRetryAt: number | null;
              lastErrorCode: string | null;
            }[],
          }),
      readProviderEventRecovery(
        deps.db,
        caseIds,
        access.value.capabilities.includes("payments.manage"),
      ),
      readPaymentReactionRecovery(
        deps.db,
        caseIds,
        access.value.capabilities.includes("payments.manage"),
      ),
    ]);
  const versions = new Map(caseRows.results.map((row) => [row.id, row.version]));
  const now = Date.now();
  const items: AdminPaymentAttentionItem[] = pageRows.map((row) => {
    const rowCaseIds = row.caseIds.split(",");
    const actions: AdminPaymentAttentionItem["actions"][number][] = [];
    const lookup = lookupRows.results.find((item) => item.paymentIntentId === row.paymentIntentId);
    if (
      lookup?.status === "EXHAUSTED" &&
      (!lookup.leaseToken || lookup.availableAt <= now) &&
      access.value.capabilities.includes("payments.manage")
    )
      actions.push({
        kind: "RECHECK_PAYMENT",
        caseId: null,
        refundId: null,
        expectedVersion: lookup.paymentVersion,
        expectedPaymentVersion: lookup.paymentVersion,
        expectedRecoveryVersion: lookup.version,
      });
    for (const caseId of rowCaseIds) {
      const event = providerRecoveries.get(caseId);
      if (event?.canRetry)
        actions.push({
          kind: "RETRY_PROVIDER_EVENT",
          caseId,
          refundId: null,
          expectedVersion: versions.get(caseId) ?? 0,
          expectedPaymentVersion: null,
          expectedRecoveryVersion: null,
        });
      const reaction = reactionRecoveries.get(caseId);
      if (reaction?.canRetry && !actions.some((action) => action.kind === "RETRY_PAYMENT_REACTION"))
        actions.push({
          kind: "RETRY_PAYMENT_REACTION",
          caseId,
          refundId: null,
          expectedVersion: versions.get(caseId) ?? 0,
          expectedPaymentVersion: reaction.paymentVersion,
          expectedRecoveryVersion: null,
        });
    }
    const refund = refundRows.results.find(
      (item) =>
        item.paymentIntentId === row.paymentIntentId &&
        item.processingStartedAt === null &&
        item.nextRetryAt === null &&
        (item.status === "ESCALATED" ||
          (["SUCCEEDED", "FAILED"].includes(item.status) && item.lastErrorCode !== null)),
    );
    if (refund && access.value.capabilities.includes("refunds.manage"))
      actions.push({
        kind: "RECHECK_REFUND",
        caseId: null,
        refundId: refund.id,
        expectedVersion: refund.version,
        expectedPaymentVersion: null,
        expectedRecoveryVersion: null,
      });
    const checking =
      (lookup !== undefined && lookup.status === "PENDING") ||
      rowCaseIds.some((caseId) => {
        const event = providerRecoveries.get(caseId);
        const reaction = reactionRecoveries.get(caseId);
        return (
          (event !== undefined && event.state !== "RECONCILIATION_REQUIRED") ||
          (reaction !== undefined && reaction.state === "PENDING")
        );
      });
    const deleted = row.customerStatus === "closed";
    return {
      groupKey: row.groupKey,
      paymentIntentId: row.paymentIntentId,
      customerName: deleted ? "Deleted customer" : row.customerName,
      customerEmail: deleted ? null : row.customerEmail,
      amountMinor: row.amountMinor,
      currency: row.currency,
      problem: attentionProblem(row.categories),
      state: checking ? "CHECKING_AUTOMATICALLY" : "NEEDS_ATTENTION",
      caseIds: rowCaseIds,
      actions,
      openedAt: new Date(row.openedAt).toISOString(),
    };
  });
  const last = pageRows[pageRows.length - 1];
  return {
    ok: true,
    value: {
      items,
      total: count?.count ?? 0,
      nextCursor:
        rows.results.length > limit && last
          ? encodeStaffCursor({ createdAt: last.openedAt, id: last.groupKey })
          : null,
    },
    requestId: request.requestId,
  };
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
    clauses.push("(s.created_at < ? OR (s.created_at = ? AND s.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  if (query !== "") {
    clauses.push("(u.email LIKE ? OR s.id LIKE ?)");
    binds.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(`${MEMBERSHIP_SELECT} ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`)
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
  const hasMore = rows.results.length > limit;
  const pageRows = rows.results.slice(0, limit);
  const items: AdminMembershipSummary[] = pageRows.map((row) => ({
    subscriptionId: row.subscriptionId,
    customerEmail: row.customerEmail,
    state: row.state,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    currentPeriodEndsAt:
      row.currentPeriodEndsAt === null ? null : new Date(row.currentPeriodEndsAt).toISOString(),
    version: row.version,
  }));
  const last = pageRows[pageRows.length - 1];
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
    clauses.push(
      request.status === "CLAIMED"
        ? "issue.status IN ('CLAIMED','INVESTIGATING','ESCALATED')"
        : "issue.status = ?",
    );
    if (request.status !== "CLAIMED") binds.push(request.status);
  }
  if (cursor) {
    clauses.push("(issue.created_at < ? OR (issue.created_at = ? AND issue.id < ?))");
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await deps.db
    .prepare(
      `SELECT issue.id, issue.order_id AS orderId, orders.order_number AS orderNumber,
              orders.address_snapshot_json AS addressSnapshotJson, customer_user.email AS customerEmail,
              issue.category, issue.status, issue.details,
              issue.assigned_staff_id AS assignedStaffId, assigned_staff.display_name AS assignedStaffName,
              issue.resolution, issue.version, issue.created_at AS createdAt
       FROM order_issue issue
       JOIN grocery_order orders ON orders.id = issue.order_id
       JOIN customer customer_profile ON customer_profile.id = issue.customer_id
       JOIN user customer_user ON customer_user.id = customer_profile.auth_user_id
       LEFT JOIN staff_identity assigned_staff ON assigned_staff.id = issue.assigned_staff_id
       ${where} ORDER BY issue.created_at DESC, issue.id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<{
      id: string;
      orderId: string;
      orderNumber: string | null;
      addressSnapshotJson: string;
      customerEmail: string;
      category: AdminOrderIssueView["category"];
      status: AdminOrderIssueView["status"];
      details: string | null;
      assignedStaffId: string | null;
      assignedStaffName: string | null;
      resolution: string | null;
      version: number;
      createdAt: number;
    }>();
  const hasMore = rows.results.length > limit;
  const items: AdminOrderIssueSummary[] = rows.results.slice(0, limit).map((row) => ({
    issueId: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerName: toOrderCustomer(row.addressSnapshotJson, row.customerEmail).name,
    customerPhone: toOrderCustomer(row.addressSnapshotJson, row.customerEmail).phone,
    customerEmail: row.customerEmail,
    category: row.category,
    status: row.status,
    details: row.details,
    assignedStaffId: row.assignedStaffId,
    assignedStaffName: row.assignedStaffName,
    resolution: row.resolution,
    allowedActions: access.value.capabilities.includes("orders.manage")
      ? allowedOrderIssueActions(row.status)
      : [],
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  const last = rows.results[Math.min(rows.results.length, limit) - 1];
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
      `SELECT issue.id, issue.order_id AS orderId, orders.order_number AS orderNumber,
              orders.address_snapshot_json AS addressSnapshotJson, customer_user.email AS customerEmail,
              issue.category, issue.status, issue.details,
              issue.assigned_staff_id AS assignedStaffId, assigned_staff.display_name AS assignedStaffName,
              issue.resolution, issue.version, issue.created_at AS createdAt
       FROM order_issue issue
       JOIN grocery_order orders ON orders.id = issue.order_id
       JOIN customer customer_profile ON customer_profile.id = issue.customer_id
       JOIN user customer_user ON customer_user.id = customer_profile.auth_user_id
       LEFT JOIN staff_identity assigned_staff ON assigned_staff.id = issue.assigned_staff_id
       WHERE issue.id = ?`,
    )
    .bind(request.issueId)
    .first<{
      id: string;
      orderId: string;
      orderNumber: string | null;
      addressSnapshotJson: string;
      customerEmail: string;
      category: AdminOrderIssueDetail["category"];
      status: AdminOrderIssueDetail["status"];
      details: string | null;
      assignedStaffId: string | null;
      assignedStaffName: string | null;
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
      orderNumber: row.orderNumber,
      customerName: toOrderCustomer(row.addressSnapshotJson, row.customerEmail).name,
      customerPhone: toOrderCustomer(row.addressSnapshotJson, row.customerEmail).phone,
      customerEmail: row.customerEmail,
      category: row.category,
      status: row.status,
      details: row.details,
      assignedStaffId: row.assignedStaffId,
      assignedStaffName: row.assignedStaffName,
      resolution: row.resolution,
      allowedActions: access.value.capabilities.includes("orders.manage")
        ? allowedOrderIssueActions(row.status)
        : [],
      version: row.version,
      createdAt: new Date(row.createdAt).toISOString(),
    },
    requestId: request.requestId,
  };
}
