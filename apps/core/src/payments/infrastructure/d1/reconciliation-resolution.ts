/** Current financial/operational evidence required before an exception can be closed.
 * This is command-owned policy SQL, shared with the purpose-built review projection.
 */
export const reconciliationResolutionEvidence = `EXISTS (
 SELECT 1 FROM payment_intent resolved_payment
 WHERE resolved_payment.id=payment_reconciliation_case.payment_intent_id
 AND (payment_reconciliation_case.category!='REFUND_UNRESOLVED' OR EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND (r.reconciliation_case_id=payment_reconciliation_case.id OR r.id=CASE WHEN json_valid(payment_reconciliation_case.details_json) THEN json_extract(payment_reconciliation_case.details_json,'$.refundId') END) AND r.status='SUCCEEDED' AND r.next_retry_at IS NULL))
 AND resolved_payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED','FAILED','EXPIRED')
 AND NOT EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND (r.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') OR r.next_retry_at IS NOT NULL OR (r.status='FAILED' AND resolved_payment.status!='REFUNDED')))
 AND NOT EXISTS (SELECT 1 FROM payment_reaction r WHERE r.payment_intent_id=resolved_payment.id AND r.status IN ('PENDING','ESCALATED'))
 AND NOT EXISTS (SELECT 1 FROM order_cancellation_refund_member m JOIN order_cancellation c ON c.id=m.cancellation_id WHERE m.payment_intent_id=resolved_payment.id AND c.status!='COMPLETED')
 AND (
   (resolved_payment.status IN ('FAILED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=resolved_payment.id AND a.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED')))
   OR (resolved_payment.status='REFUNDED' AND resolved_payment.amount_minor=(SELECT COALESCE(SUM(r.amount_minor),0) FROM payment_refund r WHERE r.payment_intent_id=resolved_payment.id AND r.status='SUCCEEDED'))
   OR (resolved_payment.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
     AND NOT EXISTS (SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=resolved_payment.id AND reaction.status!='SUCCEEDED')
     AND (EXISTS (SELECT 1 FROM payment_reaction reaction WHERE reaction.payment_intent_id=resolved_payment.id AND reaction.status='SUCCEEDED')
       OR EXISTS (SELECT 1 FROM grocery_order o JOIN payment_attempt a ON a.id=o.payment_id WHERE a.payment_intent_id=resolved_payment.id)))
 ))`;
export const unresolvedReconciliationReason =
  "Linked payment evidence and all required order/refund recovery must be complete before resolution.";
