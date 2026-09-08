import type {
  AdminCustomerSessionRevocationRequest,
  AppErrorCode,
  RpcResult,
  SessionRevocationResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  beginCustomerAdministrationWrite,
  completeCustomerAdministrationWrite,
  requireCustomerWrite,
} from "./customer-administration-write";
import {
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";
const SCOPE = "admin.customers.sessions.revoke";
const receiptSchema = z.object({ revokedSessionCount: z.number().int().nonnegative() });
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/** Revocation uses Better Auth's session storage; it creates no second session authority. */
export async function revokeCustomerSessions(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerSessionRevocationRequest,
): Promise<RpcResult<SessionRevocationResult>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (!reason)
    return failure("VALIDATION_FAILED", "A revocation reason is required", request.requestId);
  const hash = await requestHash({ customerId: request.customerId, reason });
  async function replay(): Promise<RpcResult<SessionRevocationResult> | null> {
    const saved = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    if (saved.resultReference !== null) {
      try {
        const value: unknown =
          saved.resultType === SCOPE && /^\d+$/.test(saved.resultReference)
            ? { revokedSessionCount: Number(saved.resultReference) }
            : saved.resultType === "customer_session_revocation_snapshot"
              ? JSON.parse(saved.resultReference)
              : null;
        const parsed = receiptSchema.safeParse(value);
        if (parsed.success) return { ok: true, value: parsed.data, requestId: request.requestId };
      } catch {
        /* Malformed evidence must never trigger another session deletion. */
      }
    }
    return failure(
      "INTERNAL_ERROR",
      "Saved session revocation result is unavailable",
      request.requestId,
    );
  }
  const prior = await replay();
  if (prior) return prior;
  const target = await deps.db
    .prepare("SELECT auth_user_id,version FROM customer WHERE id=?")
    .bind(request.customerId)
    .first<{ auth_user_id: string; version: number }>();
  if (!target) return failure("NOT_FOUND", "Customer not found", request.requestId);
  const count = await deps.db
    .prepare("SELECT COUNT(*) count FROM session WHERE user_id=?")
    .bind(target.auth_user_id)
    .first<{ count: number }>();
  if (!count) return failure("INTERNAL_ERROR", "Sessions could not be reviewed", request.requestId);
  const value = { revokedSessionCount: count.count };
  const now = Date.now();
  try {
    await deps.db.batch([
      ...beginCustomerAdministrationWrite(deps.db, {
        ...access.value,
        scope: SCOPE,
        key: request.idempotencyKey,
        hash,
        resultType: "customer_session_revocation_snapshot",
        now,
      }),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer WHERE id=? AND auth_user_id=? AND version=?) OR (SELECT COUNT(*) FROM session WHERE user_id=?)!=?",
        )
        .bind(
          request.customerId,
          target.auth_user_id,
          target.version,
          target.auth_user_id,
          value.revokedSessionCount,
        ),
      deps.db.prepare("DELETE FROM session WHERE user_id=?").bind(target.auth_user_id),
      deps.db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=? OR EXISTS(SELECT 1 FROM session WHERE user_id=?)",
        )
        .bind(value.revokedSessionCount, target.auth_user_id),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.SESSIONS_REVOKED",
        resourceType: "customer",
        resourceId: request.customerId,
        reason,
        details: value,
        correlationId: request.requestId,
        occurredAt: now,
      }),
      requireCustomerWrite(deps.db),
      ...completeCustomerAdministrationWrite(deps.db, {
        scope: SCOPE,
        key: request.idempotencyKey,
        hash,
        result: value,
        now,
      }),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "Customer access or sessions changed; retry the same request",
        request.requestId,
      )
    );
  }
  return { ok: true, value, requestId: request.requestId };
}
