import type {
  AdminMembershipLifecycleRequest,
  AdminMembershipSummary,
  AdminOrderCancelRequest,
  AdminOrderIssueActionRequest,
  OrderIssueStatus,
  AdminOrderIssueView,
  AdminReconciliationCaseView,
  AdminRefundRequest,
  AdminRefundView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { allowedOrderIssueActions } from "./order-issue-policy";
import { cancelOrder } from "../../orders/application/cancel-order";
import { requestRefund } from "../../payments/application/request-refund";
import { cancelSubscription } from "../../membership/application/change-subscription";
import { claimCommandIdempotency } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { log } from "../../observability";
import {
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";
import { getAdminOrder } from "./finance-reads";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
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
): Promise<RpcResult<import("@freshmarkets/contracts").AdminOrderDetail>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.manage");
  if (!access.ok) return access;
  const reason = (request.reason ?? request.reasonCode ?? "").trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason code is required", request.requestId);
  }

  const result = await cancelOrder(
    deps.db,
    {
      orderId: request.orderId,
      expectedVersion: request.expectedVersion,
      reason,
      actor: "BUSINESS",
      cause: "OPERATIONAL_FAILURE",
      idempotencyKey: request.idempotencyKey,
      requestId: request.requestId,
    },
    {
      requestRefund: deps.payments
        ? async (input) => {
            const refund = await requestRefund(deps.db, deps.payments!, {
              ...input,
              actorId: access.value.authUserId,
              requestId: request.requestId,
            });
            return refund.ok
              ? {
                  ok: true,
                  refundId: refund.value.refundId,
                  refundState: refund.value.state,
                }
              : { ok: false, refundState: "REJECTED" as const };
          }
        : undefined,
      evidence: (guard) => [
        auditEventStatement(
          deps.db,
          {
            actorUserId: access.value.authUserId,
            action: "ORDER.CANCELED",
            resourceType: "order",
            resourceId: request.orderId,
            reason,
            details: { outcome: guard.outcome, resolution: request.resolution ?? null },
            correlationId: request.requestId,
            occurredAt: Date.now(),
          },
          guard,
        ),
      ],
    },
  );
  if (!result.ok) {
    const allowed: ReadonlyArray<AppErrorCode> = [
      "NOT_FOUND",
      "VALIDATION_FAILED",
      "STALE_VERSION",
      "ILLEGAL_TRANSITION",
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

  return getAdminOrder(deps, request, "orders.manage");
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
      "SELECT COALESCE(SUM(amount_minor), 0) AS refunded FROM payment_refund WHERE payment_intent_id = ? AND status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED')",
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
    const refundGuard =
      "EXISTS (SELECT 1 FROM payment_refund WHERE id=? AND payment_intent_id=? AND status='REQUESTED')";
    const batchResult = await deps.db.batch([
      deps.db
        .prepare(
          `INSERT INTO payment_refund (id, payment_intent_id, amount_minor, currency, status, reason, idempotency_key, version, created_at, updated_at)
           SELECT ?, i.id, ?, i.currency, 'REQUESTED', ?, ?, 1, ?, ?
           FROM payment_intent i
           WHERE i.id = ? AND i.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
             AND ? <= i.amount_minor - COALESCE((SELECT SUM(amount_minor) FROM payment_refund r WHERE r.payment_intent_id=i.id AND r.status IN ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED')), 0)`,
        )
        .bind(
          refundId,
          request.amountMinor,
          reason,
          request.idempotencyKey,
          now,
          now,
          request.paymentIntentId,
          request.amountMinor,
        ),
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "PAYMENT.REFUND_REQUESTED",
          resourceType: "payment_refund",
          resourceId: refundId,
          reason,
          details: { paymentIntentId: request.paymentIntentId, amountMinor: request.amountMinor },
          correlationId: request.requestId,
          occurredAt: now,
        },
        { clause: refundGuard, binds: [refundId, request.paymentIntentId] },
      ),
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${refundGuard}`,
        )
        .bind(
          refundId,
          now,
          "admin.payments.refund",
          request.idempotencyKey,
          refundId,
          request.paymentIntentId,
        ),
    ]);
    if ((batchResult[0]?.meta?.changes ?? 0) !== 1) {
      await idempotencyFailed(deps.db, "admin.payments.refund", request.idempotencyKey);
      return failure(
        "VALIDATION_FAILED",
        "Refund exceeds the refundable amount",
        request.requestId,
      );
    }
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
          "SELECT id, payment_intent_id, category, status, created_at, resolved_at FROM payment_reconciliation_case WHERE id = ?",
        )
        .bind(request.caseId)
        .first<{
          id: string;
          payment_intent_id: string | null;
          category: AdminReconciliationCaseView["category"];
          status: "OPEN" | "RESOLVED";
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

  const reconciliationGuard =
    "EXISTS (SELECT 1 FROM payment_reconciliation_case WHERE id = ? AND status = 'RESOLVED' AND resolved_at = ?)";
  const batchResult = await deps.db.batch([
    deps.db
      .prepare(
        "UPDATE payment_reconciliation_case SET status='RESOLVED', resolved_at=?, details_json=details_json WHERE id=? AND status='OPEN'",
      )
      .bind(now, request.caseId),
    auditEventStatement(
      deps.db,
      {
        actorUserId: access.value.authUserId,
        action: "PAYMENT.RECONCILIATION_RESOLVED",
        resourceType: "payment_reconciliation_case",
        resourceId: request.caseId,
        reason,
        before: { status: "OPEN" },
        after: { status: "RESOLVED" },
        correlationId: request.requestId,
        occurredAt: now,
      },
      { clause: reconciliationGuard, binds: [request.caseId, now] },
    ),
    deps.db
      .prepare(
        `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
       WHERE scope=? AND idempotency_key=? AND status='PROCESSING' AND ${reconciliationGuard}`,
      )
      .bind(
        request.caseId,
        now,
        "admin.payments.reconcile",
        request.idempotencyKey,
        request.caseId,
        now,
      ),
  ]);
  if ((batchResult[0]?.meta?.changes ?? 0) !== 1) {
    await idempotencyFailed(deps.db, "admin.payments.reconcile", request.idempotencyKey);
    return failure("VALIDATION_FAILED", "Only open cases can be resolved", request.requestId);
  }

  const resolved = await deps.db
    .prepare(
      "SELECT id, payment_intent_id, category, status, created_at, resolved_at FROM payment_reconciliation_case WHERE id = ?",
    )
    .bind(request.caseId)
    .first<{
      id: string;
      payment_intent_id: string | null;
      category: AdminReconciliationCaseView["category"];
      status: "OPEN" | "RESOLVED";
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
      createdAt: new Date(resolved.created_at).toISOString(),
      resolvedAt:
        resolved.resolved_at === null ? null : new Date(resolved.resolved_at).toISOString(),
    },
    requestId: request.requestId,
  };
}

/**
 * Membership cancellation wrapped with staff authorization and audit.
 * Provider billing state changes arrive only through verified observations.
 */
export async function changeAdminMembership(
  deps: FinanceAdministrationDeps,
  request: AdminMembershipLifecycleRequest,
): Promise<RpcResult<AdminMembershipSummary>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "memberships.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (reason === "") {
    return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  }

  // Canonical membership commands own the lifecycle idempotency record. On a
  // successful replay, return the current projection without appending a
  // second admin audit event.
  const lifecycleScope = "membership.cancel";
  const replay = await deps.db
    .prepare(
      "SELECT status, result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
    )
    .bind(lifecycleScope, request.idempotencyKey)
    .first<{ status: string; result_reference: string | null }>();
  if (replay?.status === "SUCCEEDED" && replay.result_reference) {
    const existing = await deps.db
      .prepare(
        `SELECT s.id AS subscriptionId, u.email AS customerEmail, s.status AS state,
                s.cancel_at_period_end AS cancelAtPeriodEnd,
                s.current_period_ends_at AS currentPeriodEndsAt, s.version
         FROM subscription s JOIN customer c ON c.id = s.customer_id
         JOIN user u ON u.id = c.auth_user_id WHERE s.id = ?`,
      )
      .bind(replay.result_reference)
      .first<{
        subscriptionId: string;
        customerEmail: string;
        state: string;
        cancelAtPeriodEnd: number;
        currentPeriodEndsAt: number | null;
        version: number;
      }>();
    if (existing) {
      return {
        ok: true,
        value: {
          subscriptionId: existing.subscriptionId,
          customerEmail: existing.customerEmail,
          state: existing.state,
          cancelAtPeriodEnd: existing.cancelAtPeriodEnd === 1,
          currentPeriodEndsAt:
            existing.currentPeriodEndsAt === null
              ? null
              : new Date(existing.currentPeriodEndsAt).toISOString(),
          version: existing.version,
        },
        requestId: request.requestId,
      };
    }
  }

  const command = {
    subscriptionId: request.subscriptionId,
    reason,
    idempotencyKey: request.idempotencyKey,
    expectedVersion: request.expectedVersion,
    requestId: request.requestId,
  };
  const transitionOptions = {
    actorType: "ADMIN" as const,
    evidence: (guard: { clause: string; binds: ReadonlyArray<unknown> }) => [
      auditEventStatement(
        deps.db,
        {
          actorUserId: access.value.authUserId,
          action: "MEMBERSHIP.CANCELED",
          resourceType: "subscription",
          resourceId: request.subscriptionId,
          reason,
          after: { state: "CANCELED" },
          correlationId: request.requestId,
          occurredAt: Date.now(),
        },
        guard,
      ),
    ],
  };
  const result = await cancelSubscription(
    deps.db,
    {
      ...command,
      timing: request.timing ?? "IMMEDIATE",
    },
    transitionOptions,
  );
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

  const membership = await deps.db
    .prepare(
      `SELECT s.id AS subscriptionId, u.email AS customerEmail, s.status AS state,
              s.cancel_at_period_end AS cancelAtPeriodEnd,
              s.current_period_ends_at AS currentPeriodEndsAt, s.version
       FROM subscription s JOIN customer c ON c.id = s.customer_id
       JOIN user u ON u.id = c.auth_user_id WHERE s.id = ?`,
    )
    .bind(request.subscriptionId)
    .first<{
      subscriptionId: string;
      customerEmail: string;
      state: string;
      cancelAtPeriodEnd: number;
      currentPeriodEndsAt: number | null;
      version: number;
    }>();
  if (!membership) return failure("NOT_FOUND", "Membership not found", request.requestId);
  return {
    ok: true,
    value: {
      subscriptionId: membership.subscriptionId,
      customerEmail: membership.customerEmail,
      state: membership.state,
      cancelAtPeriodEnd: membership.cancelAtPeriodEnd === 1,
      currentPeriodEndsAt:
        membership.currentPeriodEndsAt === null
          ? null
          : new Date(membership.currentPeriodEndsAt).toISOString(),
      version: membership.version,
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
            allowedActions: allowedOrderIssueActions(existing.status as OrderIssueStatus),
            version: existing.version as number,
            createdAt: new Date(existing.created_at as number).toISOString(),
          },
          requestId: request.requestId,
        };
      }
    }
    return failure("CONFLICT", "The issue action is still processing", request.requestId);
  }

  const transition = ISSUE_TRANSITIONS[request.action];
  if (!transition || !transition.from.includes(row.status)) {
    await idempotencyFailed(deps.db, "admin.issues.action", request.idempotencyKey);
    return failure(
      "ILLEGAL_TRANSITION",
      `${request.action} is not legal from ${row.status}`,
      request.requestId,
    );
  }

  const resolution = transition.terminal ? reason : row.resolution;
  try {
    const batchResult = await deps.db.batch([
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
      deps.db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=?
           WHERE scope=? AND idempotency_key=? AND status='PROCESSING'
             AND EXISTS (SELECT 1 FROM order_issue WHERE id=? AND status=? AND version=?)`,
        )
        .bind(
          request.issueId,
          now,
          "admin.issues.action",
          request.idempotencyKey,
          request.issueId,
          transition.to,
          request.expectedVersion + 1,
        ),
    ]);
    if ((batchResult[1]?.meta?.changes ?? 0) !== 1) {
      await idempotencyFailed(deps.db, "admin.issues.action", request.idempotencyKey);
      return failure("STALE_VERSION", "Issue changed; refresh before retrying", request.requestId);
    }
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
    .first<Omit<AdminOrderIssueView, "allowedActions" | "createdAt"> & { createdAt: number }>();
  if (!updated)
    return failure("INTERNAL_ERROR", "The issue could not be read back", request.requestId);
  const view: AdminOrderIssueView = {
    ...updated,
    allowedActions: allowedOrderIssueActions(updated.status),
    createdAt: new Date(updated.createdAt).toISOString(),
  };
  return { ok: true, value: view, requestId: request.requestId };
}
