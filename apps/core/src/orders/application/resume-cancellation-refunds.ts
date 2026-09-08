import { completeZeroRefundCancellation } from "./complete-zero-refund-cancellation";
import type { RefundState } from "@freshmarkets/contracts";
import { synchronizeOrderCancellationForPayment } from "./advance-order-cancellation";

export type CancellationRefundPort = (input: {
  paymentIntentId: string;
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
}) => Promise<{ ok: boolean; refundId?: string; refundState?: RefundState }>;

const RETRY_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 5;

/** Resume persisted intent. An existing Refund is reconciled, never blindly resubmitted. */
export async function resumeCancellationRefunds(
  database: D1Database,
  cancellationId: string,
  requestRefund: CancellationRefundPort,
  now = Date.now(),
): Promise<number> {
  const cancellation = await database
    .prepare("SELECT reason,status FROM order_cancellation WHERE id=?")
    .bind(cancellationId)
    .first<{ reason: string; status: string }>();
  if (!cancellation || cancellation.status === "COMPLETED") return 0;
  const members = await database
    .prepare(
      "SELECT id,payment_intent_id,required_amount_minor FROM order_cancellation_refund_member WHERE cancellation_id=? ORDER BY created_at,id",
    )
    .bind(cancellationId)
    .all<{ id: string; payment_intent_id: string; required_amount_minor: number }>();
  if (members.results.length === 0) {
    await completeZeroRefundCancellation(database, cancellationId, now);
    return 0;
  }
  let attempted = 0;
  for (const member of members.results) {
    await synchronizeOrderCancellationForPayment(database, member.payment_intent_id);
    const key = `order-cancel:${cancellationId}:${member.payment_intent_id}`;
    const refund = await database
      .prepare("SELECT status FROM payment_refund WHERE idempotency_key=?")
      .bind(key)
      .first<{ status: string }>();
    if (refund) {
      // REQUESTED after an interrupted submit has an unknown external outcome.
      // Canonical provider ingress/reconciliation must settle it before another effect.
      if (["REQUESTED", "REJECTED", "FAILED", "ESCALATED"].includes(refund.status))
        await markException(database, cancellationId, now);
      continue;
    }
    const claim = await database
      .prepare(`UPDATE order_cancellation_refund_member SET attempts=attempts+1,updated_at=?
      WHERE id=? AND status='NOT_REQUESTED' AND attempts<? AND (attempts=0 OR updated_at<=?)
      AND EXISTS (SELECT 1 FROM order_cancellation WHERE id=? AND status!='COMPLETED')
      AND NOT EXISTS (SELECT 1 FROM payment_refund WHERE idempotency_key=?)`)
      .bind(now, member.id, MAX_ATTEMPTS, now - RETRY_DELAY_MS, cancellationId, key)
      .run();
    if (claim.meta.changes !== 1) continue;
    attempted++;
    try {
      const result = await requestRefund({
        paymentIntentId: member.payment_intent_id,
        amountMinor: member.required_amount_minor,
        reason: cancellation.reason,
        idempotencyKey: key,
      });
      await synchronizeOrderCancellationForPayment(database, member.payment_intent_id);
      if (!result.ok) await markException(database, cancellationId, now);
    } catch {
      // The accepted cancellation survives provider failure. Its saved member
      // identity and bounded retry remain available to the scheduled recovery path.
      await markException(database, cancellationId, now);
    }
  }
  await database
    .prepare(
      "UPDATE order_cancellation SET status='REFUNDS_PROCESSING',version=version+1,updated_at=? WHERE id=? AND status='REQUESTED'",
    )
    .bind(now, cancellationId)
    .run();
  return attempted;
}

async function markException(database: D1Database, id: string, now: number) {
  await database
    .prepare(
      "UPDATE order_cancellation SET status='EXCEPTION',version=version+1,updated_at=? WHERE id=? AND status NOT IN ('EXCEPTION','COMPLETED')",
    )
    .bind(now, id)
    .run();
}

/** Select due saved intents inside Orders; scheduling only supplies the clock/provider port. */
export async function resumeDueCancellationRefunds(
  database: D1Database,
  requestRefund: CancellationRefundPort,
  now: number,
) {
  const due = await database
    .prepare(`SELECT cancellation.id FROM order_cancellation cancellation
    WHERE cancellation.status!='COMPLETED' AND ((cancellation.required_refund_minor=0 AND EXISTS (SELECT 1 FROM grocery_order o WHERE o.id=cancellation.order_id AND (o.status IN ('CANCELLATION_REQUESTED','EXCEPTION') OR (cancellation.actor_type='STAFF_EXCEPTION' AND o.status='DELIVERED'))) AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member WHERE cancellation_id=cancellation.id)) OR EXISTS (
      SELECT 1 FROM order_cancellation_refund_member member LEFT JOIN payment_refund refund
        ON refund.id=member.refund_id OR (member.refund_id IS NULL AND refund.idempotency_key='order-cancel:'||member.cancellation_id||':'||member.payment_intent_id)
      WHERE member.cancellation_id=cancellation.id AND (
        (member.status='NOT_REQUESTED' AND member.attempts<? AND (member.attempts=0 OR member.updated_at<=?))
        OR (refund.id IS NOT NULL AND (member.refund_id IS NULL OR member.status!=refund.status)))))
    ORDER BY cancellation.updated_at,cancellation.id LIMIT 10`)
    .bind(MAX_ATTEMPTS, now - RETRY_DELAY_MS)
    .all<{ id: string }>();
  let attempted = 0;
  for (const cancellation of due.results)
    attempted += await resumeCancellationRefunds(database, cancellation.id, requestRefund, now);
  return { considered: due.results.length, attempted };
}
