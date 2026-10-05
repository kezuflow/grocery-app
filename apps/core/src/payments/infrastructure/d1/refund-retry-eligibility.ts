/** Uses the fixed `refund` alias. Unknown outcomes never authorize another financial effect. */
export const rejectedRefundRetryEligibility = `refund.status='REJECTED'
 AND refund.provider_refund_reference IS NULL AND refund.processing_started_at IS NULL
 AND refund.next_retry_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM audit_event event WHERE event.aggregate_id=refund.id AND event.action='PAYMENT.REFUND_RETRIED')
 AND EXISTS (SELECT 1 FROM payment_intent payment WHERE payment.id=refund.payment_intent_id
   AND payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND payment.currency=refund.currency
   AND refund.amount_minor<=payment.amount_minor-(SELECT COALESCE(SUM(reserved.amount_minor),0)
     FROM payment_refund reserved WHERE reserved.payment_intent_id=payment.id
     AND reserved.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED')))
 AND EXISTS (SELECT 1 FROM payment_attempt attempt WHERE attempt.payment_intent_id=refund.payment_intent_id
   AND attempt.status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND length(trim(attempt.provider_reference))>0)
 AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member member
   JOIN order_cancellation cancellation ON cancellation.id=member.cancellation_id
   WHERE member.payment_intent_id=refund.payment_intent_id AND (cancellation.status='COMPLETED'
     OR member.refund_id IS NOT refund.id OR member.required_amount_minor!=refund.amount_minor OR member.currency!=refund.currency))`;
