import {
  orderStates,
  type AdminOrderStatusOverrideRequest,
  type AdminOrderStatusOverrideResult,
  type AppErrorCode,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

export const orderStatusOverrideCommandSchema = z.object({
  orderId: z.string().trim().min(1).max(200),
  status: z.enum(orderStates),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
const receiptSchema = z.object({
  orderId: z.string(),
  previousStatus: z.string(),
  status: z.enum(orderStates),
  version: z.number().int().positive(),
});
const scope = "orders.status_override";

/** Owner-authorized correction: only the Order status/version, audit and receipt may change. */
export async function overrideOrderStatus(
  database: D1Database,
  request: AdminOrderStatusOverrideRequest,
  actor: { authUserId: string; staffId: string },
): Promise<RpcResult<AdminOrderStatusOverrideResult>> {
  const failure = (
    code: AppErrorCode,
    message: string,
  ): RpcResult<AdminOrderStatusOverrideResult> => ({
    ok: false,
    error: { code, message, requestId: request.requestId },
  });
  const parsed = orderStatusOverrideCommandSchema.safeParse(request);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "A canonical Order status, reason, current version and request key are required",
    );
  const command = parsed.data;
  const hash = await requestHash({ ...command, actorAuthUserId: actor.authUserId });
  const replay = async (): Promise<RpcResult<AdminOrderStatusOverrideResult> | null> => {
    const prior = await findIdempotencyRecord(database, scope, command.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key belongs to a different status correction",
      );
    if (prior.status === "SUCCEEDED" && prior.resultReference) {
      let stored: unknown;
      try {
        stored = JSON.parse(prior.resultReference);
      } catch {
        return failure("INTERNAL_ERROR", "The original status correction receipt is unavailable");
      }
      const receipt = receiptSchema.safeParse(stored);
      if (
        receipt.success &&
        prior.resultType === "order_status_override_receipt" &&
        receipt.data.orderId === command.orderId &&
        receipt.data.status === command.status &&
        receipt.data.version === command.expectedVersion + 1
      )
        return { ok: true, value: receipt.data, requestId: request.requestId };
      return failure("INTERNAL_ERROR", "The original status correction receipt is unavailable");
    }
    return failure("CONFLICT", "The original status correction has not been confirmed");
  };
  const previous = await replay();
  if (previous) return previous;
  const order = await database
    .prepare("SELECT status,version FROM grocery_order WHERE id=?")
    .bind(command.orderId)
    .first<{ status: string; version: number }>();
  if (!order) return failure("NOT_FOUND", "Order not found");
  if (order.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Order changed; refresh before correcting its status");
  const receipt: AdminOrderStatusOverrideResult = {
    orderId: command.orderId,
    previousStatus: order.status,
    status: command.status,
    version: order.version + 1,
  };
  const now = Date.now();
  const assertEffect = () =>
    database.prepare("INSERT INTO commitment_abort(id) SELECT -41 WHERE changes()<>1");
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -41 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
        JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission permission ON permission.id=rp.permission_id
        JOIN staff_scope assignment ON assignment.staff_id=staff.id
        WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active'
        AND assignment.scope_kind='global' AND permission.code='orders.manage')`)
        .bind(actor.staffId, actor.authUserId),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,result_reference,created_at,updated_at)
        VALUES (?,?,?,'SUCCEEDED','order_status_override_receipt',?,?,?) ON CONFLICT(scope,idempotency_key) DO NOTHING`)
        .bind(scope, command.idempotencyKey, hash, JSON.stringify(receipt), now, now),
      assertEffect(),
      database
        .prepare(
          "UPDATE grocery_order SET status=?,version=version+1 WHERE id=? AND version=? AND status=?",
        )
        .bind(command.status, command.orderId, command.expectedVersion, order.status),
      assertEffect(),
      auditEventStatement(database, {
        actorUserId: actor.authUserId,
        action: "ORDER.STATUS_OVERRIDDEN",
        resourceType: "order",
        resourceId: command.orderId,
        reason: command.reason,
        before: { status: order.status, version: order.version },
        after: { status: receipt.status, version: receipt.version },
        details: { effect: "ORDER_STATUS_ONLY" },
        idempotencyKey: command.idempotencyKey,
        correlationId: request.requestId,
        occurredAt: now,
      }),
      assertEffect(),
    ]);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (!(error instanceof Error) || !/constraint failed/i.test(error.message)) throw error;
    return failure(
      "STALE_VERSION",
      "Order or administrator access changed; refresh before retrying",
    );
  }
  return { ok: true, value: receipt, requestId: request.requestId };
}
