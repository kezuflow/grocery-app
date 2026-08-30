import type { RefundState } from "@freshmarkets/contracts";

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
  const update = await database
    .prepare(
      `UPDATE order_cancellation_refund_member
       SET refund_id=COALESCE(refund_id,?), status=?, updated_at=?
       WHERE id=? AND status!='SUCCEEDED'`,
    )
    .bind(input.refundId, input.refundState, now, member.id)
    .run();
  const completed = await completeIfReady(database, member.cancellation_id, now);
  if (!completed && ["REJECTED", "FAILED", "ESCALATED"].includes(input.refundState))
    await database
      .prepare(
        "UPDATE order_cancellation SET status='EXCEPTION',version=version+1,updated_at=? WHERE id=? AND status!='COMPLETED'",
      )
      .bind(now, member.cancellation_id)
      .run();
  return { applied: (update.meta?.changes ?? 0) === 1, completed };
}

export async function synchronizeOrderCancellationForPayment(
  database: D1Database,
  paymentIntentId: string,
): Promise<void> {
  const rows = await database
    .prepare(
      `SELECT m.refund_id, r.status
       FROM order_cancellation_refund_member m
       JOIN payment_refund r ON r.id=m.refund_id
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

async function completeIfReady(
  database: D1Database,
  cancellationId: string,
  now: number,
): Promise<boolean> {
  const pending = await database
    .prepare(
      "SELECT COUNT(*) AS count FROM order_cancellation_refund_member WHERE cancellation_id=? AND status!='SUCCEEDED'",
    )
    .bind(cancellationId)
    .first<{ count: number }>();
  if ((pending?.count ?? 0) !== 0) return false;
  const cancellation = await database
    .prepare("SELECT order_id,actor_type,status FROM order_cancellation WHERE id=?")
    .bind(cancellationId)
    .first<{ order_id: string; actor_type: string; status: string }>();
  if (!cancellation) return false;
  await database.batch([
    database
      .prepare(
        "UPDATE order_cancellation SET status='COMPLETED',version=version+1,updated_at=? WHERE id=? AND status!='COMPLETED'",
      )
      .bind(now, cancellationId),
    database
      .prepare(
        `UPDATE grocery_order SET status='CANCELED',version=version+1
         WHERE id=? AND status IN ('CANCELLATION_REQUESTED','EXCEPTION')
           AND ?!='STAFF_EXCEPTION'`,
      )
      .bind(cancellation.order_id, cancellation.actor_type),
  ]);
  return true;
}
