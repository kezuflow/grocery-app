import type { RefundState } from "@freshmarkets/contracts";
import { projectOrderCancellationNotification } from "../../notifications/application/project-domain-notifications";

export async function advanceOrderCancellation(
  database: D1Database,
  input: { paymentIntentId: string; refundId: string; refundState: RefundState },
): Promise<{ applied: boolean; completed: boolean }> {
  const now = Date.now();
  const member = await database
    .prepare(
      `SELECT m.id, m.cancellation_id, m.status
       FROM order_cancellation_refund_member m
       WHERE m.payment_intent_id=? AND (m.refund_id=? OR m.refund_id IS NULL)
       ORDER BY m.created_at DESC LIMIT 1`,
    )
    .bind(input.paymentIntentId, input.refundId)
    .first<{ id: string; cancellation_id: string; status: string }>();
  if (!member) return { applied: false, completed: false };
  // The observation is a wake-up signal. Only the current Payments row can
  // authorize a projection, including recovery before the refund ID was linked.
  const updates = await database.batch([
    database
      .prepare(`UPDATE order_cancellation_refund_member AS member
      SET refund_id=?,status=(SELECT status FROM payment_refund WHERE id=?),updated_at=?
      WHERE member.id=? AND member.status!='SUCCEEDED' AND EXISTS (
        SELECT 1 FROM payment_refund refund WHERE refund.id=?
        AND refund.payment_intent_id=member.payment_intent_id
        AND refund.amount_minor=member.required_amount_minor AND refund.currency=member.currency
        AND (member.refund_id=refund.id OR (member.refund_id IS NULL
          AND refund.idempotency_key='order-cancel:'||member.cancellation_id||':'||member.payment_intent_id)))`)
      .bind(input.refundId, input.refundId, now, member.id, input.refundId),
    database
      .prepare(`UPDATE order_cancellation SET status='COMPLETED',version=version+1,updated_at=?
      WHERE id=? AND status!='COMPLETED'
      AND EXISTS (SELECT 1 FROM order_cancellation_refund_member WHERE cancellation_id=order_cancellation.id)
      AND NOT EXISTS (
        SELECT 1 FROM order_cancellation_refund_member member LEFT JOIN payment_refund refund ON refund.id=member.refund_id
        WHERE member.cancellation_id=order_cancellation.id AND
        (member.status!='SUCCEEDED' OR refund.id IS NULL OR refund.status!='SUCCEEDED'
          OR refund.payment_intent_id!=member.payment_intent_id OR refund.amount_minor!=member.required_amount_minor OR refund.currency!=member.currency))`)
      .bind(now, member.cancellation_id),
    database
      .prepare(`UPDATE grocery_order SET status='CANCELED',version=version+1
      WHERE status IN ('CANCELLATION_REQUESTED','EXCEPTION') AND EXISTS (
        SELECT 1 FROM order_cancellation cancellation WHERE cancellation.id=? AND cancellation.order_id=grocery_order.id
        AND cancellation.status='COMPLETED' AND cancellation.actor_type!='STAFF_EXCEPTION')`)
      .bind(member.cancellation_id),
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -20 WHERE EXISTS (
      SELECT 1 FROM order_cancellation cancellation JOIN grocery_order grocery ON grocery.id=cancellation.order_id
      WHERE cancellation.id=? AND cancellation.status='COMPLETED' AND cancellation.actor_type!='STAFF_EXCEPTION'
      AND grocery.status!='CANCELED')`)
      .bind(member.cancellation_id),
    database
      .prepare(`UPDATE order_cancellation SET status='EXCEPTION',version=version+1,updated_at=?
      WHERE id=? AND status NOT IN ('COMPLETED','EXCEPTION') AND EXISTS (
        SELECT 1 FROM order_cancellation_refund_member member JOIN payment_refund refund ON refund.id=member.refund_id
        WHERE member.cancellation_id=order_cancellation.id AND member.status=refund.status
        AND refund.payment_intent_id=member.payment_intent_id AND refund.amount_minor=member.required_amount_minor
        AND refund.currency=member.currency AND refund.status IN ('REJECTED','FAILED','ESCALATED'))`)
      .bind(now, member.cancellation_id),
  ]);
  const cancellation = await database
    .prepare("SELECT status FROM order_cancellation WHERE id=?")
    .bind(member.cancellation_id)
    .first<{ status: string }>();
  const completed = cancellation?.status === "COMPLETED";
  try {
    if (completed)
      await projectOrderCancellationNotification(database, {
        cancellationId: member.cancellation_id,
        state: "COMPLETED",
      });
    else if (cancellation?.status === "EXCEPTION")
      await projectOrderCancellationNotification(database, {
        cancellationId: member.cancellation_id,
        state: "EXCEPTION",
      });
  } catch {
    // Notifications remain a retryable projection, never refund authority.
  }
  return { applied: (updates[0]?.meta?.changes ?? 0) === 1, completed };
}

export async function synchronizeOrderCancellationForPayment(
  database: D1Database,
  paymentIntentId: string,
): Promise<void> {
  const rows = await database
    .prepare(
      `SELECT r.id refund_id, r.status
       FROM order_cancellation_refund_member m
       JOIN payment_refund r ON r.payment_intent_id=m.payment_intent_id
         AND (r.id=m.refund_id OR (m.refund_id IS NULL AND r.idempotency_key='order-cancel:'||m.cancellation_id||':'||m.payment_intent_id))
       WHERE m.payment_intent_id=?`,
    )
    .bind(paymentIntentId)
    .all<{ refund_id: string; status: RefundState }>();
  for (const row of rows.results)
    await advanceOrderCancellation(database, {
      paymentIntentId,
      refundId: row.refund_id,
      refundState: row.status,
    });
}
