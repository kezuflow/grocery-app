import type {
  AdminMembershipLifecycleRequest,
  AdminMembershipSummary,
  AdminOrderCancelRequest,
  AdminOrderIssueActionRequest,
  OrderIssueStatus,
  AdminOrderIssueView,
  AdminOrderSummary,
  AdminReconciliationCaseView,
  AdminRefundRequest,
  AdminRefundView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { cancelOrder } from "../../orders/application/cancel-order";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
} from "../../membership/application/change-subscription";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import {
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

/** Admin order cancellation through the canonical command. */
export async function cancelAdminOrder(
  deps: FinanceAdministrationDeps,
  request: AdminOrderCancelRequest,
): Promise<RpcResult<AdminOrderSummary>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.manage");
  if (!access.ok) return access;
  if (request.reasonCode.trim() === "") {
    return failure("VALIDATION_FAILED", "A reason code is required", request.requestId);
  }

  const result = await cancelOrder(deps.db, {
    orderId: request.orderId,
    expectedVersion: request.expectedVersion,
    reasonCode: request.reasonCode.trim(),
    idempotencyKey: request.idempotencyKey,
    requestId: request.requestId,
  });
  if (!result.ok) {
    const allowed: ReadonlyArray<AppErrorCode> = [
      "NOT_FOUND",
      "VALIDATION_FAILED",
      "STALE_VERSION",
      "IDEMPOTENCY_CONFLICT",
      "CONFLICT",
    ];
    const code = (allowed as ReadonlyArray<string>).includes(result.error.code)
      ? (result.error.code as AppErrorCode)
      : "CONFLICT";
    return {
      ok: false,
      error: { code, message: result.error.message, requestId: request.requestId },
    };
  }
  if (result.value.state === "UNCHANGED") {
    return failure("VALIDATION_FAILED", "Order is not in a cancellable state", request.requestId);
  }

  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "ORDER.CANCELED",
      resourceType: "order",
      resourceId: request.orderId,
      reason: request.reasonCode.trim(),
      details: { outcome: result.value.state },
      correlationId: request.requestId,
      occurredAt: Date.now(),
    }),
  ]);

  const summary = await deps.db
    .prepare(
      `SELECT o.id AS orderId, u.email AS customerEmail, o.status, o.total_minor AS totalMinor,
              o.currency, o.created_at AS committedAt
       FROM grocery_order o JOIN customer c ON c.id = o.customer_id
       JOIN user u ON u.id = c.auth_user_id WHERE o.id = ?`,
    )
    .bind(request.orderId)
    .first<{
      orderId: string;
      customerEmail: string;
      status: string;
      totalMinor: number;
      currency: string;
      committedAt: number;
    }>();
  if (!summary) return failure("NOT_FOUND", "Order not found", request.requestId);
  return {
    ok: true,
    value: {
      orderId: summary.orderId,
      customerEmail: summary.customerEmail,
      status: summary.status,
      totalMinor: summary.totalMinor,
      currency: summary.currency,
      paymentStatus: null,
      fulfillmentStatus: null,
      deliveryStatus: null,
      committedAt: new Date(summary.committedAt).toISOString(),
    },
    requestId: request.requestId,
  };
}

/**
 * Request a refund on a payment intent: inserts a REQUESTED payment_refund
 * row with idempotency. Canonical outcomes arrive through the provider seam;
 * admin never asserts success.
 */
export async function requestAdminRefund(
  deps: FinanceAdministrationDeps,
  request: AdminRefundRequest,
): Promise<RpcResult<AdminRefundView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "refunds.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  const intent = await deps.db
    .prepare("SELECT id, amount_minor, currency, status FROM payment_intent WHERE id = ?")
    .bind(request.paymentIntentId)
    .first<{ id: string; amount_minor: number; currency: string; status: string }>();
  if (!intent) return failure("NOT_FOUND", "Payment intent not found", request.requestId);
  if (intent.status !== "SUCCEEDED" && intent.status !== "PARTIALLY_REFUNDED") {
    return failure(
      "VALIDATION_FAILED",
      "Only succeeded payments can be refunded",
      request.requestId,
    );
  }
  if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
    return failure(
      "VALIDATION_FAILED",
      "amountMinor must be a positive integer",
      request.requestId,
    );
  }
  const refundedRow = await deps.db
    .prepare(
      "SELECT COALESCE(SUM(amount_minor), 0) AS refunded FROM payment_refund WHERE payment_intent_id = ? AND status = 'SUCCEEDED'",
    )
    .bind(request.paymentIntentId)
    .first<{ refunded: number }>();
  const refunded = refundedRow?.refunded ?? 0;
  if (refunded + request.amountMinor > intent.amount_minor) {
    return failure("VALIDATION_FAILED", "Refund exceeds the refundable amount", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.payments.refund",
    request.idempotencyKey,
    {
      paymentIntentId: request.paymentIntentId,
      amountMinor: request.amountMinor,
      reason,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const existing = await deps.db
        .prepare(
          "SELECT id, payment_intent_id, amount_minor, currency, status, reason, created_at FROM payment_refund WHERE id = ?",
        )
        .bind(claim.existing.resultReference)
        .first<{
          id: string;
          payment_intent_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          reason: string | null;
          created_at: number;
        }>();
      if (existing) {
        return {
          ok: true,
          value: {
            refundId: existing.id,
            paymentIntentId: existing.payment_intent_id,
            amountMinor: existing.amount_minor,
            currency: existing.currency,
            status: existing.status,
            reason: existing.reason,
            createdAt: new Date(existing.created_at).toISOString(),
          },
          requestId: request.requestId,
        };
      }
    }
    return failure("CONFLICT", "The refund command is still processing", request.requestId);
  }

  const refundId = crypto.randomUUID();
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          "INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, 1, ?, ?)",
        )
        .bind(
          refundId,
          request.paymentIntentId,
          request.amountMinor,
          intent.currency,
          reason,
          request.idempotencyKey,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "PAYMENT.REFUND_REQUESTED",
        resourceType: "payment_refund",
        resourceId: refundId,
        reason,
        details: { paymentIntentId: request.paymentIntentId, amountMinor: request.amountMinor },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, "admin.payments.refund", request.idempotencyKey, refundId, now),
    ]);
  } catch (error) {
    log("error", "admin.payments.refund_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.payments.refund", request.idempotencyKey);
    return failure("CONFLICT", "The refund could not be recorded", request.requestId);
  }

  return {
    ok: true,
    value: {
      refundId,
      paymentIntentId: request.paymentIntentId,
      amountMinor: request.amountMinor,
      currency: intent.currency,
      status: "REQUESTED",
      reason,
      createdAt: new Date(now).toISOString(),
    },
    requestId: request.requestId,
  };
}

/** Resolve an open reconciliation case with a required reason; audited. */
export async function resolveAdminReconciliationCase(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminReconciliationResolveRequest,
): Promise<RpcResult<AdminReconciliationCaseView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "refunds.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A resolution reason is required", request.requestId);
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.payments.reconcile",
    request.idempotencyKey,
    {
      caseId: request.caseId,
      reason,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      const existing = await deps.db
        .prepare(
          "SELECT id, payment_intent_id, category, status, details_json, created_at, resolved_at FROM payment_reconciliation_case WHERE id = ?",
        )
        .bind(request.caseId)
        .first<{
          id: string;
          payment_intent_id: string | null;
          category: AdminReconciliationCaseView["category"];
          status: "OPEN" | "RESOLVED";
          details_json: string;
          created_at: number;
          resolved_at: number | null;
        }>();
      if (existing) {
        return {
          ok: true,
          value: {
            caseId: existing.id,
            paymentIntentId: existing.payment_intent_id,
            category: existing.category,
            status: existing.status,
            details: existing.details_json,
            createdAt: new Date(existing.created_at).toISOString(),
            resolvedAt:
              existing.resolved_at === null ? null : new Date(existing.resolved_at).toISOString(),
          },
          requestId: request.requestId,
        };
      }
    }
    return failure("CONFLICT", "The resolve command is still processing", request.requestId);
  }

  const updated = await deps.db
    .prepare(
      "UPDATE payment_reconciliation_case SET status='RESOLVED', resolved_at=?, details_json=details_json WHERE id=? AND status='OPEN'",
    )
    .bind(now, request.caseId)
    .run();
  if ((updated.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, "admin.payments.reconcile", request.idempotencyKey);
    return failure("VALIDATION_FAILED", "Only open cases can be resolved", request.requestId);
  }
  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "PAYMENT.RECONCILIATION_RESOLVED",
      resourceType: "payment_reconciliation_case",
      resourceId: request.caseId,
      reason,
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
      correlationId: request.requestId,
      occurredAt: now,
    }),
    idempotencyComplete(
      deps.db,
      "admin.payments.reconcile",
      request.idempotencyKey,
      request.caseId,
      now,
    ),
  ]);

  const resolved = await deps.db
    .prepare(
      "SELECT id, payment_intent_id, category, status, details_json, created_at, resolved_at FROM payment_reconciliation_case WHERE id = ?",
    )
    .bind(request.caseId)
    .first<{
      id: string;
      payment_intent_id: string | null;
      category: AdminReconciliationCaseView["category"];
      status: "OPEN" | "RESOLVED";
      details_json: string;
      created_at: number;
      resolved_at: number | null;
    }>();
  if (!resolved)
    return failure("INTERNAL_ERROR", "The case could not be read back", request.requestId);
  return {
    ok: true,
    value: {
      caseId: resolved.id,
      paymentIntentId: resolved.payment_intent_id,
      category: resolved.category,
      status: resolved.status,
      details: resolved.details_json,
      createdAt: new Date(resolved.created_at).toISOString(),
      resolvedAt:
        resolved.resolved_at === null ? null : new Date(resolved.resolved_at).toISOString(),
    },
    requestId: request.requestId,
  };
}

type LifecycleAction = "PAUSE" | "RESUME" | "CANCEL";

/**
 * Membership lifecycle through the canonical pause/resume/cancel commands,
 * wrapped with staff authorization and audit. Recover is deferred until a
 * provider-confirmed canonical outcome source exists.
 */
export async function changeAdminMembership(
  deps: FinanceAdministrationDeps,
  request: AdminMembershipLifecycleRequest,
  action: LifecycleAction,
): Promise<RpcResult<AdminMembershipSummary>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  const command = {
    subscriptionId: request.subscriptionId,
    reason,
    idempotencyKey: request.idempotencyKey,
    expectedVersion: request.expectedVersion,
    requestId: request.requestId,
  };
  const result =
    action === "PAUSE"
      ? await pauseSubscription(deps.db, command)
      : action === "RESUME"
        ? await resumeSubscription(deps.db, command)
        : await cancelSubscription(deps.db, {
            ...command,
            timing: request.timing ?? "IMMEDIATE",
          });
  if (!result.ok) {
    const allowed: ReadonlyArray<AppErrorCode> = [
      "NOT_FOUND",
      "VALIDATION_FAILED",
      "STALE_VERSION",
      "IDEMPOTENCY_CONFLICT",
      "CONFLICT",
    ];
    const code = (allowed as ReadonlyArray<string>).includes(result.error.code)
      ? (result.error.code as AppErrorCode)
      : "CONFLICT";
    return {
      ok: false,
      error: { code, message: result.error.message, requestId: request.requestId },
    };
  }

  await deps.db.batch([
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: `MEMBERSHIP.${action}ED`,
      resourceType: "subscription",
      resourceId: request.subscriptionId,
      reason,
      after: { state: result.value.state },
      correlationId: request.requestId,
      occurredAt: Date.now(),
    }),
  ]);
  return {
    ok: true,
    value: {
      subscriptionId: result.value.subscriptionId,
      customerEmail: "",
      state: result.value.state,
      cancelAtPeriodEnd: result.value.cancelAtPeriodEnd,
      currentPeriodEndsAt: result.value.trialEndsAt,
      version: result.value.version,
    },
    requestId: request.requestId,
  };
}

const ISSUE_TRANSITIONS: Record<
  string,
  { from: OrderIssueStatus[]; to: OrderIssueStatus; terminal: boolean }
> = {
  CLAIM: { from: ["SUBMITTED"], to: "CLAIMED", terminal: false },
  BEGIN_INVESTIGATION: { from: ["CLAIMED", "ESCALATED"], to: "INVESTIGATING", terminal: false },
  RESOLVE: { from: ["CLAIMED", "INVESTIGATING"], to: "RESOLVED", terminal: true },
  ESCALATE: { from: ["CLAIMED", "INVESTIGATING"], to: "ESCALATED", terminal: false },
  REOPEN: { from: ["RESOLVED"], to: "INVESTIGATING", terminal: false },
};

/** Apply a closed issue action through the legal transition map. */
export async function applyAdminOrderIssueAction(
  deps: FinanceAdministrationDeps,
  request: AdminOrderIssueActionRequest,
): Promise<RpcResult<AdminOrderIssueView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  const row = await deps.db
    .prepare(
      "SELECT id, order_id, category, status, details, assigned_staff_id, resolution, version, created_at FROM order_issue WHERE id = ?",
    )
    .bind(request.issueId)
    .first<{
      id: string;
      order_id: string;
      category: AdminOrderIssueView["category"];
      status: OrderIssueStatus;
      details: string | null;
      assigned_staff_id: string | null;
      resolution: string | null;
      version: number;
      created_at: number;
    }>();
  if (!row) return failure("NOT_FOUND", "Order issue not found", request.requestId);

  const transition = ISSUE_TRANSITIONS[request.action];
  if (!transition.from.includes(row.status)) {
    return failure(
      "ILLEGAL_TRANSITION",
      `${request.action} is not legal from ${row.status}`,
      request.requestId,
    );
  }

  const now = Date.now();
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    "admin.issues.action",
    request.idempotencyKey,
    {
      issueId: request.issueId,
      action: request.action,
      reason,
      expectedVersion: request.expectedVersion,
    },
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash) {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    }
    if (claim.existing?.status === "SUCCEEDED") {
      const existing = await deps.db
        .prepare(
          "SELECT id, order_id, category, status, details, assigned_staff_id, resolution, version, created_at FROM order_issue WHERE id = ?",
        )
        .bind(request.issueId)
        .first<Record<string, unknown>>();
      if (existing) {
        return {
          ok: true,
          value: {
            issueId: existing.id as string,
            orderId: existing.order_id as string,
            category: existing.category as AdminOrderIssueView["category"],
            status: existing.status as OrderIssueStatus,
            details: existing.details as string | null,
            assignedStaffId: existing.assigned_staff_id as string | null,
            resolution: existing.resolution as string | null,
            version: existing.version as number,
            createdAt: new Date(existing.created_at as number).toISOString(),
          },
          requestId: request.requestId,
        };
      }
    }
    return failure("CONFLICT", "The issue action is still processing", request.requestId);
  }

  const resolution = transition.terminal ? reason : row.resolution;
  try {
    await deps.db.batch([
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: `ISSUE.${request.action}`,
          resourceType: "order_issue",
          resourceId: request.issueId,
          reason,
          before: { status: row.status },
          after: { status: transition.to },
          correlationId: request.requestId,
          occurredAt: now,
        },
        {
          clause: "EXISTS (SELECT 1 FROM order_issue WHERE id = ? AND version = ?)",
          binds: [request.issueId, request.expectedVersion],
        },
      ),
      deps.db
        .prepare(
          "UPDATE order_issue SET status=?, assigned_staff_id=?, resolution=?, updated_at=?, version=version+1 WHERE id=? AND status=? AND version=?",
        )
        .bind(
          transition.to,
          access.value.staffId,
          resolution,
          now,
          request.issueId,
          row.status,
          request.expectedVersion,
        ),
    ]);
  } catch (error) {
    log("error", "admin.issues.action_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await idempotencyFailed(deps.db, "admin.issues.action", request.idempotencyKey);
    return failure("CONFLICT", "The issue action could not be applied", request.requestId);
  }

  const after = await deps.db
    .prepare("SELECT version FROM order_issue WHERE id = ?")
    .bind(request.issueId)
    .first<{ version: number }>();
  if (after?.version !== request.expectedVersion + 1) {
    return failure("STALE_VERSION", "Issue changed; refresh before retrying", request.requestId);
  }
  const updated = await deps.db
    .prepare(
      "SELECT id, order_id AS orderId, category, status, details, assigned_staff_id AS assignedStaffId, resolution, version, created_at AS createdAt FROM order_issue WHERE id = ?",
    )
    .bind(request.issueId)
    .first<AdminOrderIssueView & { createdAt: number }>();
  if (!updated)
    return failure("INTERNAL_ERROR", "The issue could not be read back", request.requestId);
  const view: AdminOrderIssueView = {
    ...updated,
    createdAt: new Date(updated.createdAt).toISOString(),
  };
  return { ok: true, value: view, requestId: request.requestId };
}
