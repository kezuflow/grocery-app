import { auditEventStatement } from "../../audit/application/append-audit-event";

/** Compose zero-balance completion with admission, or recover a retained accepted zero-balance intent. */
export function zeroRefundCancellationStatements(
  database: D1Database,
  input: { cancellationId: string; orderId: string; orderVersion: number; now: number },
): D1PreparedStatement[] {
  const key = `zero-refund-cancellation:${input.cancellationId}`;
  return [
    database
      .prepare(`UPDATE order_cancellation SET status='COMPLETED',version=version+1,updated_at=? WHERE id=? AND order_id=? AND status!='COMPLETED' AND required_refund_minor=0
    AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member WHERE cancellation_id=order_cancellation.id)
    AND EXISTS (SELECT 1 FROM grocery_order WHERE id=order_cancellation.order_id AND version=? AND (status IN ('CANCELLATION_REQUESTED','EXCEPTION') OR (order_cancellation.actor_type='STAFF_EXCEPTION' AND status='DELIVERED')))`)
      .bind(input.now, input.cancellationId, input.orderId, input.orderVersion),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -20 WHERE changes()!=1"),
    database
      .prepare(
        "UPDATE grocery_order SET status='CANCELED',version=version+1 WHERE id=? AND version=? AND status IN ('CANCELLATION_REQUESTED','EXCEPTION') AND EXISTS (SELECT 1 FROM order_cancellation WHERE id=? AND status='COMPLETED' AND actor_type!='STAFF_EXCEPTION')",
      )
      .bind(input.orderId, input.orderVersion, input.cancellationId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM order_cancellation c JOIN grocery_order o ON o.id=c.order_id WHERE c.id=? AND c.status='COMPLETED' AND ((c.actor_type='STAFF_EXCEPTION' AND o.version=?) OR (c.actor_type!='STAFF_EXCEPTION' AND o.status='CANCELED' AND o.version=?)))",
      )
      .bind(input.cancellationId, input.orderVersion, input.orderVersion + 1),
    auditEventStatement(database, {
      actorUserId: null,
      action: "ORDER.CANCELLATION_COMPLETED",
      resourceType: "order_cancellation",
      resourceId: input.cancellationId,
      reason: "No remaining payment balance requires a new refund",
      idempotencyKey: key,
      correlationId: key,
      occurredAt: input.now,
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -20 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='ORDER.CANCELLATION_COMPLETED' AND idempotency_key=?)",
      )
      .bind(input.cancellationId, key),
  ];
}

export async function completeZeroRefundCancellation(
  database: D1Database,
  cancellationId: string,
  now: number,
): Promise<boolean> {
  const row = await database
    .prepare(
      "SELECT c.order_id,o.version FROM order_cancellation c JOIN grocery_order o ON o.id=c.order_id WHERE c.id=? AND c.status!='COMPLETED' AND c.required_refund_minor=0 AND (o.status IN ('CANCELLATION_REQUESTED','EXCEPTION') OR (c.actor_type='STAFF_EXCEPTION' AND o.status='DELIVERED')) AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member WHERE cancellation_id=c.id)",
    )
    .bind(cancellationId)
    .first<{ order_id: string; version: number }>();
  if (!row) return false;
  await database.batch(
    zeroRefundCancellationStatements(database, {
      cancellationId,
      orderId: row.order_id,
      orderVersion: row.version,
      now,
    }),
  );
  return true;
}
