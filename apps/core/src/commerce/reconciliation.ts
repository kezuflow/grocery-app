import { releaseUncommittedCheckoutStatements } from "../checkout/application/release-uncommitted-checkout";

const expirableAttempt = `SELECT 1 FROM checkout_attempts attempt
  WHERE attempt.id=? AND attempt.customer_id=? AND attempt.status='PROCESSING'
    AND attempt.expires_at IS NOT NULL AND attempt.expires_at<=?
    AND NOT EXISTS (SELECT 1 FROM payment_intent payment
      WHERE payment.subject_type='checkout_quote' AND payment.subject_id=attempt.id
        AND payment.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
    AND NOT EXISTS (SELECT 1 FROM order_payment_reaction reaction
      WHERE reaction.checkout_quote_id=attempt.id)`;

/** Expire only unpaid attempts. An Instant hold is not a committed reservation. */
export async function expireCheckoutAttempts(db: D1Database, now: number): Promise<number> {
  const attempts = await db
    .prepare(
      `SELECT attempt.id,attempt.customer_id,attempt.idempotency_key FROM checkout_attempts attempt
       WHERE attempt.status='PROCESSING' AND attempt.expires_at IS NOT NULL
         AND attempt.expires_at<=?
         AND NOT EXISTS (SELECT 1 FROM payment_intent payment
           WHERE payment.subject_type='checkout_quote' AND payment.subject_id=attempt.id
             AND payment.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
         AND NOT EXISTS (SELECT 1 FROM order_payment_reaction reaction
           WHERE reaction.checkout_quote_id=attempt.id)`,
    )
    .bind(now)
    .all<{ id: string; customer_id: string; idempotency_key: string }>();

  let expired = 0;
  for (const attempt of attempts.results) {
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (${expirableAttempt})`,
          )
          .bind(attempt.id, attempt.customer_id, now),
        ...releaseUncommittedCheckoutStatements(db, {
          quoteId: attempt.id,
          paymentIntentId: null,
          customerId: attempt.customer_id,
          now,
          attemptStatus: "EXPIRED",
        }),
        db
          .prepare(
            "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope='checkout.quote' AND idempotency_key=? AND status='PROCESSING'",
          )
          .bind(now, attempt.idempotency_key),
      ]);
      expired += 1;
    } catch (error) {
      // A payment or another command may have won after candidate discovery.
      // Preserve unexpected storage failures for job-level recovery.
      const stillExpirable = await db
        .prepare(expirableAttempt)
        .bind(attempt.id, attempt.customer_id, now)
        .first();
      if (stillExpirable) throw error;
    }
  }
  return expired;
}
