const recoveryEvidence = ` AND NOT EXISTS (
   SELECT 1 FROM payment_provider_event_inbox inbox
   WHERE inbox.processing_status IN ('RECEIVED','RETRY_REQUIRED','RECONCILIATION_REQUIRED')
   AND (
     EXISTS (SELECT 1 FROM payment_attempt attempt WHERE attempt.payment_intent_id=resolved_payment.id AND attempt.provider=inbox.provider AND attempt.provider_reference=inbox.provider_reference)
     OR (inbox.provider=CASE WHEN json_valid(payment_reconciliation_case.details_json) THEN json_extract(payment_reconciliation_case.details_json,'$.provider') END
       AND inbox.provider_event_id=CASE WHEN json_valid(payment_reconciliation_case.details_json) THEN json_extract(payment_reconciliation_case.details_json,'$.providerEventId') END)
   )
 )
 AND (payment_reconciliation_case.category!='REFUND_UNRESOLVED' OR EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND (r.reconciliation_case_id=payment_reconciliation_case.id OR r.id=CASE WHEN json_valid(payment_reconciliation_case.details_json) THEN json_extract(payment_reconciliation_case.details_json,'$.refundId') END) AND r.status='SUCCEEDED' AND r.next_retry_at IS NULL))
 AND NOT EXISTS (SELECT 1 FROM payment_creation_observation creation WHERE creation.payment_intent_id=resolved_payment.id AND creation.applied_at IS NULL)
 AND resolved_payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED','FAILED','EXPIRED')
 AND NOT EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND (r.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') OR r.next_retry_at IS NOT NULL OR (r.status='FAILED' AND resolved_payment.status!='REFUNDED')))
 AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member m JOIN order_cancellation c ON c.id=m.cancellation_id WHERE m.payment_intent_id=resolved_payment.id AND c.status!='COMPLETED')
`;
/** Current financial/operational evidence required before an exception can be closed.
 * This is command-owned policy SQL, shared with the purpose-built review projection.
 */
export const completedReconciliationResolutionEvidence = `EXISTS (
 SELECT 1 FROM payment_intent resolved_payment
 WHERE resolved_payment.id=payment_reconciliation_case.payment_intent_id
 ${recoveryEvidence}
 AND NOT EXISTS (SELECT 1 FROM payment_reaction r WHERE r.payment_intent_id=resolved_payment.id AND r.status IN ('PENDING','ESCALATED'))
 AND (
   (resolved_payment.status IN ('FAILED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=resolved_payment.id AND a.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED')))
   OR (resolved_payment.status='REFUNDED' AND resolved_payment.amount_minor=(SELECT COALESCE(SUM(r.amount_minor),0) FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND r.status='SUCCEEDED'))
   OR (resolved_payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
     AND NOT EXISTS (SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=resolved_payment.id AND reaction.status!='SUCCEEDED')
     AND (EXISTS (SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=resolved_payment.id AND reaction.status='SUCCEEDED')
       OR EXISTS (SELECT 1 FROM grocery_order o JOIN payment_attempt a ON a.id=o.payment_id WHERE a.payment_intent_id=resolved_payment.id)))
 ))`;
export const refundedCommitmentResolutionEvidence = `EXISTS (
 SELECT 1 FROM payment_intent resolved_payment JOIN payment_reaction refunded_reaction ON refunded_reaction.payment_intent_id=resolved_payment.id
 WHERE resolved_payment.id=payment_reconciliation_case.payment_intent_id AND payment_reconciliation_case.category='REACTION_FAILURE'
 AND refunded_reaction.id=CASE WHEN json_valid(payment_reconciliation_case.details_json) THEN json_extract(payment_reconciliation_case.details_json,'$.reactionId') END
 AND refunded_reaction.status IN ('ESCALATED','FAILED') AND refunded_reaction.subject_type=resolved_payment.subject_type AND refunded_reaction.subject_id=resolved_payment.subject_id
 AND ((refunded_reaction.reaction_type='COMMIT_ORDER' AND resolved_payment.purpose='GROCERY_CHECKOUT' AND resolved_payment.subject_type='checkout_quote') OR (refunded_reaction.reaction_type='COMMIT_AMENDMENT' AND resolved_payment.purpose='ORDER_AMENDMENT' AND resolved_payment.subject_type='paid_order_amendment'))
 AND resolved_payment.status='REFUNDED' AND resolved_payment.amount_minor=(SELECT COALESCE(SUM(refund.amount_minor),0) FROM payment_refund refund WHERE refund.payment_intent_id=resolved_payment.id AND refund.status='SUCCEEDED' AND refund.currency=resolved_payment.currency)
 ${recoveryEvidence}
 AND NOT EXISTS (SELECT 1 FROM payment_reaction other WHERE other.payment_intent_id=resolved_payment.id AND other.id!=refunded_reaction.id AND other.status IN ('PENDING','ESCALATED'))
 AND NOT EXISTS (SELECT 1 FROM order_payment_reaction WHERE payment_intent_id=resolved_payment.id)
 AND NOT EXISTS (SELECT 1 FROM grocery_order o JOIN payment_attempt a ON a.id=o.payment_id WHERE a.payment_intent_id=resolved_payment.id)
 AND NOT EXISTS (SELECT 1 FROM paid_order_amendment a WHERE a.payment_intent_id=resolved_payment.id AND a.status='COMMITTED')
)`;
export const reconciliationResolutionEvidence = `(${completedReconciliationResolutionEvidence} OR ${refundedCommitmentResolutionEvidence})`;
export const unresolvedReconciliationReason =
  "Linked payment evidence and all required order/refund recovery must be complete before resolution.";
