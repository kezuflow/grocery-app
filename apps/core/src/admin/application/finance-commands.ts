import { z } from "@freshmarkets/validation";
import {
  orderIssueCategories,
  orderIssueStatuses,
  orderIssueActions,
} from "@freshmarkets/contracts";
import { retryPaymentReaction } from "../../payments/application/retry-payment-reaction";
import { retryProviderEvent } from "../../payments/application/retry-provider-event";
import { recheckStaffPayment } from "../../payments/application/recheck-staff-payment";
import { resolveReconciliationCase } from "../../payments/application/resolve-reconciliation-case";
import { recheckStaffRefund } from "../../payments/application/recheck-staff-refund";
import type {
  AdminMembershipLifecycleRequest,
  AdminMembershipSummary,
  AdminOrderCancelRequest,
  AdminOrderIssueActionRequest,
  AdminOrderIssueView,
  AdminReconciliationCaseView,
  AdminRefundRequest,
  AdminRefundView,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { allowedOrderIssueActions } from "./order-issue-policy";
import { cancelOrder } from "../../orders/application/cancel-order";
import { requestStaffRefund } from "../../payments/application/request-staff-refund";
import { requestRefund } from "../../payments/application/request-refund";
import { cancelSubscription } from "../../membership/application/change-subscription";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveFinanceAdministrationAccess,
  type FinanceAdministrationDeps,
} from "./finance-administration-access";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Admin order cancellation through the canonical command. */
export async function cancelAdminOrder(
  deps: FinanceAdministrationDeps,
  request: AdminOrderCancelRequest,
): Promise<RpcResult<import("@freshmarkets/contracts").AdminOrderCancellationResult>> {
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
      actorAuthUserId: access.value.authUserId,
      resolution: request.resolution,
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
            idempotencyKey: request.idempotencyKey,
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

  const accepted = result.value;
  if (accepted.state === "CANCELED")
    return {
      ok: true,
      value: { orderId: request.orderId, state: "CANCELED", cancellation: null },
      requestId: request.requestId,
    };
  if (
    !accepted.cancellationId ||
    !accepted.status ||
    accepted.requiredRefundMinor === undefined ||
    accepted.retainedServiceFeeMinor === undefined ||
    !accepted.currency ||
    !accepted.refunds
  )
    return failure("INTERNAL_ERROR", "Cancellation receipt is incomplete", request.requestId);
  return {
    ok: true,
    value: {
      orderId: request.orderId,
      state: "CANCELLATION_REQUESTED",
      cancellation: {
        cancellationId: accepted.cancellationId,
        status: accepted.status,
        requiredRefundMinor: accepted.requiredRefundMinor,
        retainedServiceFeeMinor: accepted.retainedServiceFeeMinor,
        currency: accepted.currency,
        refunds: accepted.refunds,
      },
    },
    requestId: request.requestId,
  };
}

/** Global staff refund admission and execution are owned by Payments. */
export async function requestAdminRefund(
  deps: FinanceAdministrationDeps,
  request: AdminRefundRequest,
): Promise<RpcResult<AdminRefundView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "refunds.manage");
  if (!access.ok) return access;
  if (!deps.payments)
    return failure("CONFIGURATION_ERROR", "Payment providers are unavailable", request.requestId);
  return requestStaffRefund(deps.db, deps.payments, {
    paymentIntentId: request.paymentIntentId,
    amountMinor: request.amountMinor,
    reason: request.reason,
    expectedVersion: request.expectedVersion,
    idempotencyKey: request.idempotencyKey,
    actorAuthUserId: access.value.authUserId,
    requestId: request.requestId,
  });
}

/** Payments owns guarded resolution; Admin supplies the trusted Global actor. */
export async function resolveAdminReconciliationCase(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminReconciliationResolveRequest,
): Promise<RpcResult<AdminReconciliationCaseView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "refunds.manage");
  if (!access.ok) return access;
  return resolveReconciliationCase(deps.db, {
    ...request,
    actorAuthUserId: access.value.authUserId,
  });
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

const issueReceiptSchema = z.object({
  issueId: z.string(),
  orderId: z.string(),
  category: z.enum(orderIssueCategories),
  status: z.enum(orderIssueStatuses),
  details: z.string().nullable(),
  assignedStaffId: z.string().nullable(),
  resolution: z.string().nullable(),
  allowedActions: z.array(z.enum(orderIssueActions)),
  version: z.number().int(),
  createdAt: z.string(),
});

/** Ordinary problem handling; historical investigation states remain resolvable. */
export async function applyAdminOrderIssueAction(
  deps: FinanceAdministrationDeps,
  request: AdminOrderIssueActionRequest,
): Promise<RpcResult<AdminOrderIssueView>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "orders.manage");
  if (!access.ok) return access;
  const parsed = z
    .object({
      issueId: z.string().min(1).max(200),
      action: z.enum(orderIssueActions),
      reason: z.string().trim().min(1).max(500),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().min(1).max(200),
    })
    .safeParse(request);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Choose a valid action and add a short note",
      request.requestId,
    );
  const command = parsed.data;
  const scope = "admin.issues.action";
  // Keep the existing intent hash so retained receipts still identify their original request.
  const hash = await requestHash({
    issueId: command.issueId,
    action: command.action,
    reason: command.reason,
    expectedVersion: command.expectedVersion,
  });
  const row = await deps.db
    .prepare(
      "SELECT id AS issueId, order_id AS orderId, category, status, details, assigned_staff_id AS assignedStaffId, resolution, version, created_at AS createdAt FROM order_issue WHERE id=?",
    )
    .bind(command.issueId)
    .first<Omit<AdminOrderIssueView, "allowedActions" | "createdAt"> & { createdAt: number }>();
  if (!row) return failure("NOT_FOUND", "Problem not found", request.requestId);
  const replay = async (): Promise<RpcResult<AdminOrderIssueView> | null> => {
    const prior = await findIdempotencyRecord(deps.db, scope, command.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This key belongs to another request",
        request.requestId,
      );
    if (prior.status === "SUCCEEDED") {
      if (prior.resultType === "order_issue_receipt" && prior.resultReference) {
        const value = issueReceiptSchema.parse(JSON.parse(prior.resultReference));
        return { ok: true, value, requestId: request.requestId };
      }
      // Retained older commands stored only a report reference, not an immutable result.
      if (prior.resultReference !== command.issueId)
        return failure("CONFLICT", "The saved problem action needs review", request.requestId);
      return {
        ok: true,
        value: {
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
          allowedActions: allowedOrderIssueActions(row.status),
        },
        requestId: request.requestId,
      };
    }
    if (prior.status === "PROCESSING")
      return failure("CONFLICT", "The prior problem action needs review", request.requestId);
    return null;
  };
  const previous = await replay();
  if (previous) return previous;
  if (row.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Problem changed; refresh before retrying", request.requestId);
  if (!allowedOrderIssueActions(row.status).includes(command.action))
    return failure(
      "ILLEGAL_TRANSITION",
      "This action is unavailable for the current problem",
      request.requestId,
    );
  const status = command.action === "CLAIM" ? "CLAIMED" : "RESOLVED";
  const view: AdminOrderIssueView = {
    ...row,
    status,
    assignedStaffId: access.value.staffId,
    resolution: command.action === "RESOLVE" ? command.reason : row.resolution,
    allowedActions: allowedOrderIssueActions(status),
    version: row.version + 1,
    createdAt: new Date(row.createdAt).toISOString(),
  };
  const now = Date.now();
  const guard = () =>
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1");
  try {
    await deps.db.batch([
      deps.db
        .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
        JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
        JOIN staff_scope scope ON scope.staff_id=staff.id
        WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active' AND scope.scope_kind='global' AND p.code='orders.manage')`)
        .bind(access.value.staffId, access.value.authUserId),
      deps.db
        .prepare(
          "UPDATE order_issue SET status=?,assigned_staff_id=?,resolution=?,updated_at=?,version=version+1 WHERE id=? AND status=? AND version=?",
        )
        .bind(
          status,
          access.value.staffId,
          view.resolution,
          now,
          command.issueId,
          row.status,
          command.expectedVersion,
        ),
      guard(),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: `ISSUE.${command.action}`,
        resourceType: "order_issue",
        resourceId: command.issueId,
        reason: command.reason,
        before: { status: row.status },
        after: { status },
        correlationId: request.requestId,
        occurredAt: now,
      }),
      guard(),
      deps.db
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at)
        VALUES (?,?,?,'SUCCEEDED','order_issue_receipt',?,?,?)
        ON CONFLICT(scope,idempotency_key) DO UPDATE SET status='SUCCEEDED',result_type='order_issue_receipt',result_reference=excluded.result_reference,updated_at=excluded.updated_at
        WHERE idempotency_records.status='FAILED' AND idempotency_records.request_hash=excluded.request_hash`)
        .bind(scope, command.idempotencyKey, hash, JSON.stringify(view), now, now),
      guard(),
    ]);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (!(error instanceof Error) || !/constraint failed/i.test(error.message)) throw error;
    return failure(
      "STALE_VERSION",
      "Problem or access changed; refresh before retrying",
      request.requestId,
    );
  }
  return { ok: true, value: view, requestId: request.requestId };
}
export async function recheckAdminRefund(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminRefundRecheckRequest,
): Promise<RpcResult<import("@freshmarkets/contracts").AdminRefundRecheckResult>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "refunds.manage");
  if (!access.ok) return access;
  return recheckStaffRefund(deps.db, { ...request, actorAuthUserId: access.value.authUserId });
}

export async function recheckAdminPayment(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminPaymentRecheckRequest,
): Promise<RpcResult<import("@freshmarkets/contracts").AdminPaymentRecheckResult>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.manage");
  if (!access.ok) return access;
  return recheckStaffPayment(deps.db, { ...request, actorAuthUserId: access.value.authUserId });
}

export async function retryAdminProviderEvent(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminProviderEventRetryRequest,
): Promise<RpcResult<import("@freshmarkets/contracts").AdminProviderEventRetryResult>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.manage");
  if (!access.ok) return access;
  return retryProviderEvent(deps.db, { ...request, actorAuthUserId: access.value.authUserId });
}

export async function retryAdminPaymentReaction(
  deps: FinanceAdministrationDeps,
  request: import("@freshmarkets/contracts").AdminPaymentReactionRetryRequest,
): Promise<RpcResult<import("@freshmarkets/contracts").AdminPaymentReactionRetryResult>> {
  const access = await resolveFinanceAdministrationAccess(deps, request, "payments.manage");
  if (!access.ok) return access;
  return retryPaymentReaction(deps.db, { ...request, actorAuthUserId: access.value.authUserId });
}
