import type {
  AdminCustomerAccessChangeRequest,
  AdminCustomerSummary,
  AppErrorCode,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  resolveCustomerAdministrationAccess,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";
import {
  beginCustomerAdministrationWrite,
  requireCustomerWrite,
} from "./customer-administration-write";
import { CUSTOMER_SELECT } from "./list-admin-customers";

const scope = "admin.customers.access";
const resultType = "customer_access_change_snapshot";
const summarySchema = z.object({
  customerId: z.string(),
  authUserId: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  accessStatus: z.enum(["active", "disabled"]),
  subscriptionState: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  lastOrderAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
});
const receiptSql = `SELECT json_object('customerId',customerId,'authUserId',authUserId,'email',email,'phone',phone,'accessStatus',accessStatus,'subscriptionState',subscriptionState,'orderCount',orderCount,'lastOrderAt',strftime('%Y-%m-%dT%H:%M:%fZ',lastOrderAt/1000.0,'unixepoch'),'version',version,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',createdAt/1000.0,'unixepoch')) AS value FROM (${CUSTOMER_SELECT}) WHERE customerId=?`;

export async function changeCustomerAccess(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerAccessChangeRequest,
): Promise<RpcResult<AdminCustomerSummary>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const reason = request.reason.trim();
  if (!reason) return failure("VALIDATION_FAILED", "A reason is required", request.requestId);
  const hash = await requestHash({
    customerId: request.customerId,
    action: request.action,
    reason,
    expectedVersion: request.expectedVersion,
  });
  const db = deps.db;
  async function replay(): Promise<RpcResult<AdminCustomerSummary> | null> {
    const saved = await findIdempotencyRecord(db, scope, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    let raw = saved.resultReference;
    if (saved.resultType === scope && raw === request.customerId)
      raw =
        (await db.prepare(receiptSql).bind(request.customerId).first<{ value: string }>())?.value ??
        null;
    else if (saved.resultType !== resultType)
      return failure("INTERNAL_ERROR", "Saved access result is unavailable", request.requestId);
    const parsed = summarySchema.safeParse(parseJson(raw));
    if (!parsed.success || parsed.data.customerId !== request.customerId)
      return failure("INTERNAL_ERROR", "Saved access result is unavailable", request.requestId);
    return { ok: true, value: parsed.data, requestId: request.requestId };
  }
  const previous = await replay();
  if (previous) return previous;
  const target = await db
    .prepare(
      "SELECT c.auth_user_id,c.principal_id,c.version,c.status,cp.status AS accessStatus FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.id=?",
    )
    .bind(request.customerId)
    .first<{
      auth_user_id: string;
      principal_id: string;
      version: number;
      status: string;
      accessStatus: string;
    }>();
  if (!target) return failure("NOT_FOUND", "Customer not found", request.requestId);
  if (target.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Customer changed; refresh before retrying", request.requestId);
  const nextStatus = request.action === "DISABLE" ? "disabled" : "active";
  if (target.accessStatus === nextStatus)
    return failure(
      "VALIDATION_FAILED",
      `Commerce access is already ${nextStatus}`,
      request.requestId,
    );
  const now = Date.now();
  try {
    const results = await db.batch<{ value: string }>([
      ...beginCustomerAdministrationWrite(db, {
        ...access.value,
        scope,
        key: request.idempotencyKey,
        hash,
        resultType,
        now,
      }),
      db
        .prepare(
          "UPDATE customer_principal SET status=?,updated_at=? WHERE id=? AND auth_user_id=? AND status=? AND EXISTS(SELECT 1 FROM customer WHERE id=? AND principal_id=? AND auth_user_id=? AND version=? AND status=?)",
        )
        .bind(
          nextStatus,
          now,
          target.principal_id,
          target.auth_user_id,
          target.accessStatus,
          request.customerId,
          target.principal_id,
          target.auth_user_id,
          request.expectedVersion,
          target.status,
        ),
      requireCustomerWrite(db),
      db
        .prepare(
          "UPDATE customer SET version=version+1,updated_at=? WHERE id=? AND version=? AND principal_id=? AND auth_user_id=?",
        )
        .bind(
          now,
          request.customerId,
          request.expectedVersion,
          target.principal_id,
          target.auth_user_id,
        ),
      requireCustomerWrite(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.ACCESS_CHANGED",
        resourceType: "customer",
        resourceId: request.customerId,
        reason,
        before: { accessStatus: target.accessStatus },
        after: { accessStatus: nextStatus },
        correlationId: request.requestId,
        idempotencyKey: `${scope}:${request.idempotencyKey}`,
        occurredAt: now,
      }),
      requireCustomerWrite(db),
      db
        .prepare(
          `UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(${receiptSql}),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`,
        )
        .bind(request.customerId, now, scope, request.idempotencyKey, hash),
      requireCustomerWrite(db),
      db
        .prepare(
          "SELECT result_reference AS value FROM idempotency_records WHERE scope=? AND idempotency_key=?",
        )
        .bind(scope, request.idempotencyKey),
    ]);
    const parsed = summarySchema.safeParse(parseJson(results.at(-1)?.results[0]?.value ?? null));
    if (!parsed.success)
      return failure("INTERNAL_ERROR", "Saved access result is unavailable", request.requestId);
    return { ok: true, value: parsed.data, requestId: request.requestId };
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Customer or staff access changed; refresh and retry", request.requestId)
    );
  }
}
function parseJson(value: string | null): unknown {
  try {
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
