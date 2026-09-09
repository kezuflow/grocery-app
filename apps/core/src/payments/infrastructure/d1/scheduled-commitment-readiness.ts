/** Shared command/read predicate, correlated to the caller's delivery_cycle alias scheduled_cycle.
 * A terminal browser screen is not financial closure. Preserve unapplied provider evidence.
 */
export const unresolvedScheduledCommitmentSql = `EXISTS(SELECT 1 FROM payment_intent payment WHERE (
 (payment.subject_type='checkout_quote' AND EXISTS(SELECT 1 FROM checkout_quote q WHERE q.id=payment.subject_id AND q.delivery_cycle_id=scheduled_cycle.id)
  AND NOT EXISTS(SELECT 1 FROM order_payment_reaction link WHERE link.payment_intent_id=payment.id))
 OR (payment.subject_type='paid_order_amendment' AND EXISTS(SELECT 1 FROM paid_order_amendment a JOIN grocery_order o ON o.id=a.order_id
   WHERE a.id=payment.subject_id AND o.cycle_id=scheduled_cycle.id AND a.status<>'COMMITTED'))
 ) AND (
 payment.status NOT IN ('FAILED','EXPIRED','REFUNDED')
 OR EXISTS(SELECT 1 FROM payment_attempt attempt WHERE attempt.payment_intent_id=payment.id AND attempt.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED') AND payment.status<>'REFUNDED')
 OR EXISTS(SELECT 1 FROM payment_creation_observation creation WHERE creation.payment_intent_id=payment.id AND creation.applied_at IS NULL)
 OR EXISTS(SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=payment.id AND reaction.status IN ('PENDING','ESCALATED'))
 OR EXISTS(SELECT 1 FROM payment_provider_event_inbox inbox JOIN payment_attempt attempt ON attempt.provider=inbox.provider AND attempt.provider_reference=inbox.provider_reference
   WHERE attempt.payment_intent_id=payment.id AND inbox.processing_status IN ('RECEIVED','RETRY_REQUIRED','RECONCILIATION_REQUIRED'))
 ))`;
export const scheduledPurchasePendingMessage =
  "Payments for this week are still being confirmed. Purchase quantities will be ready after confirmation.";

export async function hasUnresolvedScheduledCommitment(
  db: D1Database,
  cycleId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT ${unresolvedScheduledCommitmentSql} pending FROM delivery_cycle scheduled_cycle WHERE scheduled_cycle.id=?`,
    )
    .bind(cycleId)
    .first<{ pending: number }>();
  // Callers establish cycle ownership first. Missing evidence cannot mean ready to purchase.
  return !row || row.pending === 1;
}
