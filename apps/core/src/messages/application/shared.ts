import type { AuthenticatedRequest, RpcResult } from "@freshmarkets/contracts";
import { drizzle } from "drizzle-orm/d1";
import { applicationContextForRequest } from "../../auth/authorization";
import type { FinanceAdministrationDeps } from "../../admin/application/finance-administration-access";
import { iamSchema } from "../../iam/schema";
import type { ResolvedCustomer } from "../../customer/principal";

export type MessageContext = {
  env: Pick<Env, "DB" | "PRODUCT_MEDIA" | "IMAGES">;
  auth: FinanceAdministrationDeps["auth"];
  access: {
    now(): number;
    resolveAuthenticatedCustomer(request: AuthenticatedRequest): Promise<ResolvedCustomer>;
  };
};

export const MESSAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Correlated to grocery_order o. Reused by the read decision and both guarded purges. */
export const ACTIVE_MESSAGE_HOLD_SQL = `
  EXISTS(SELECT 1 FROM order_message_hold h WHERE h.order_id=o.id AND h.released_at IS NULL)
  OR EXISTS(SELECT 1 FROM order_issue i WHERE i.order_id=o.id AND i.status<>'RESOLVED')
  OR EXISTS(SELECT 1 FROM order_cancellation x WHERE x.order_id=o.id AND x.status<>'COMPLETED')
  OR EXISTS(SELECT 1 FROM finance_exception e WHERE e.order_id=o.id AND e.status='OPEN')
  OR EXISTS(SELECT 1 FROM payment_refund r WHERE r.status IN
      ('REQUESTED','APPROVED','PROCESSING','ESCALATED') AND r.payment_intent_id IN (
        SELECT p.payment_intent_id FROM payment_attempt p WHERE p.id=o.payment_id
        UNION SELECT a.payment_intent_id FROM paid_order_amendment a WHERE a.order_id=o.id))
  OR EXISTS(SELECT 1 FROM payment_reconciliation_case c WHERE c.status='OPEN'
      AND c.payment_intent_id IN (
        SELECT p.payment_intent_id FROM payment_attempt p WHERE p.id=o.payment_id
        UNION SELECT a.payment_intent_id FROM paid_order_amendment a WHERE a.order_id=o.id))`;

export type MessageActor =
  | { kind: "CUSTOMER"; userId: string; customerId: string }
  | { kind: "ADMIN"; userId: string; staffId: string; global: boolean; locationIds: string[] };

export type MessageOrder = {
  id: string;
  customerId: string;
  orderNumber: string | null;
  status: string;
  closedAt: number | null;
  lastMessageAt: number | null;
  locationId: string | null;
};

export function fail(
  code: import("@freshmarkets/contracts").AppErrorCode,
  message: string,
  requestId: string,
): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}

export async function resolveMessageActor(
  context: MessageContext,
  request: AuthenticatedRequest,
  kind: "CUSTOMER" | "ADMIN",
  write = false,
  globalOnly = false,
): Promise<RpcResult<MessageActor>> {
  if (kind === "CUSTOMER") {
    const customer = await context.access.resolveAuthenticatedCustomer(request);
    if (!customer.ok) return customer;
    return {
      ok: true,
      value: { kind, userId: customer.value.user.id, customerId: customer.value.customerId },
      requestId: request.requestId,
    };
  }
  const access = await applicationContextForRequest(
    context.auth,
    drizzle(context.env.DB, { schema: iamSchema }),
    request,
  );
  if (!access.ok) return access;
  if (!access.value.authenticated || !access.value.principal)
    return fail("UNAUTHENTICATED", "Authentication is required", request.requestId);
  const staff = access.value.staffIdentity;
  const global = access.value.scopes.some((scope) => scope.kind === "global");
  const locationIds = access.value.scopes.flatMap((scope) =>
    scope.kind === "location" ? [scope.locationId] : [],
  );
  if (
    !staff ||
    staff.status !== "active" ||
    !access.value.capabilities.includes(write ? "orders.manage" : "orders.read") ||
    (globalOnly ? !global : !global && locationIds.length === 0)
  )
    return fail("FORBIDDEN", "Orders access is required", request.requestId);
  return {
    ok: true,
    value: { kind, userId: access.value.principal.userId, staffId: staff.id, global, locationIds },
    requestId: request.requestId,
  };
}

export function actorGuard(
  database: D1Database,
  actor: MessageActor,
  write = false,
  orderId?: string,
): D1PreparedStatement {
  if (actor.kind === "CUSTOMER")
    return database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (
        SELECT 1 FROM customer c JOIN customer_principal cp
          ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id
        WHERE c.id=? AND c.auth_user_id=? AND c.status='active' AND cp.status='active')`)
      .bind(actor.customerId, actor.userId);
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
      JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
      JOIN staff_scope scope ON scope.staff_id=staff.id
      WHERE staff.id=? AND staff.auth_user_id=? AND staff.status='active'
        AND p.code=? AND (scope.scope_kind='global' OR
          (scope.scope_kind='location' AND scope.location_id=(
            SELECT location_id FROM order_fulfillment_snapshot WHERE order_id=?))))`)
    .bind(actor.staffId, actor.userId, write ? "orders.manage" : "orders.read", orderId ?? "");
}

const ADMIN_ORDER_SCOPE_SQL = `EXISTS (SELECT 1 FROM staff_scope scope WHERE scope.staff_id=?
  AND (scope.scope_kind='global' OR (scope.scope_kind='location' AND
    scope.location_id=(SELECT location_id FROM order_fulfillment_snapshot WHERE order_id=o.id))))`;

export function orderGuard(database: D1Database, actor: MessageActor, orderId: string) {
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE NOT EXISTS (
      SELECT 1 FROM grocery_order o WHERE o.id=? AND o.committed_at IS NOT NULL
      ${actor.kind === "CUSTOMER" ? "AND o.customer_id=?" : `AND ${ADMIN_ORDER_SCOPE_SQL}`})`)
    .bind(...(actor.kind === "CUSTOMER" ? [orderId, actor.customerId] : [orderId, actor.staffId]));
}

export function changedGuard(database: D1Database): D1PreparedStatement {
  return database.prepare("INSERT INTO commitment_abort(id) SELECT -39 WHERE changes()<>1");
}

export async function readMessageOrder(
  database: D1Database,
  actor: MessageActor,
  orderId: string,
): Promise<MessageOrder | null> {
  return database
    .prepare(`SELECT o.id, o.customer_id AS customerId, o.order_number AS orderNumber,
      o.status, c.last_message_at AS lastMessageAt,
      (SELECT location_id FROM order_fulfillment_snapshot WHERE order_id=o.id) AS locationId,
      CASE o.status
        WHEN 'DELIVERED' THEN (SELECT MAX(d.delivered_at) FROM delivery_job d WHERE d.order_id=o.id AND d.status='DELIVERED')
        WHEN 'CANCELED' THEN (SELECT MAX(x.updated_at) FROM order_cancellation x WHERE x.order_id=o.id AND x.status='COMPLETED')
        ELSE NULL END AS closedAt
      FROM grocery_order o LEFT JOIN order_conversation c ON c.order_id=o.id
      WHERE o.id=? AND o.committed_at IS NOT NULL
      ${actor.kind === "CUSTOMER" ? "AND o.customer_id=?" : `AND ${ADMIN_ORDER_SCOPE_SQL}`}`)
    .bind(...(actor.kind === "CUSTOMER" ? [orderId, actor.customerId] : [orderId, actor.staffId]))
    .first<MessageOrder>();
}

export async function messageExpiry(
  database: D1Database,
  order: MessageOrder,
): Promise<number | null> {
  if (order.lastMessageAt === null || order.closedAt === null) return null;
  const blocked = await database
    .prepare(`SELECT (${ACTIVE_MESSAGE_HOLD_SQL}) AS blocked FROM grocery_order o WHERE o.id=?`)
    .bind(order.id)
    .first<{ blocked: number }>();
  if (blocked?.blocked) return null;
  return Math.max(order.lastMessageAt, order.closedAt) + MESSAGE_TTL_MS;
}

/** Expire readable data before admitting a new message on a previously closed Order.
 * Object removal remains a separate idempotent R2 effect; reads deny DELETE_PENDING. */
export async function expireConversationIfDue(
  database: D1Database,
  actor: MessageActor,
  order: MessageOrder,
  now: number,
): Promise<boolean> {
  const due = await messageExpiry(database, order);
  if (due === null || due > now || order.lastMessageAt === null) return true;
  try {
    await database.batch([
      actorGuard(database, actor, true, order.id),
      orderGuard(database, actor, order.id),
      database
        .prepare(`UPDATE order_conversation SET last_message_at=NULL,acknowledgement_sent=0
          WHERE order_id=? AND last_message_at=?
          AND EXISTS(SELECT 1 FROM grocery_order o WHERE o.id=order_id
            AND ((o.status='DELIVERED' AND EXISTS(SELECT 1 FROM delivery_job d
                  WHERE d.order_id=o.id AND d.status='DELIVERED' AND d.delivered_at<=?))
              OR (o.status='CANCELED' AND EXISTS(SELECT 1 FROM order_cancellation x
                  WHERE x.order_id=o.id AND x.status='COMPLETED' AND x.updated_at<=?))))
          AND last_message_at<=?
          AND NOT EXISTS(SELECT 1 FROM grocery_order o WHERE o.id=order_id
            AND (${ACTIVE_MESSAGE_HOLD_SQL}))`)
        .bind(
          order.id,
          order.lastMessageAt,
          now - MESSAGE_TTL_MS,
          now - MESSAGE_TTL_MS,
          now - MESSAGE_TTL_MS,
        ),
      changedGuard(database),
      database
        .prepare(`DELETE FROM order_message_content WHERE message_id IN
          (SELECT id FROM order_message WHERE order_id=?)`)
        .bind(order.id),
      database
        .prepare(`UPDATE order_message_upload SET status='DELETE_PENDING',file_name=NULL,
          next_attempt_at=?,updated_at=? WHERE order_id=? AND status='ATTACHED'`)
        .bind(now, now, order.id),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function digestPayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
