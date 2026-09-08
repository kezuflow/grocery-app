/** Command-owned prerequisites for replay, not authority to commit an Order. */
export const reactionRetryEvidence = `r.status='ESCALATED' AND p.status='SUCCEEDED'
 AND p.subject_id=r.subject_id AND p.subject_type=r.subject_type
 AND ((r.reaction_type='COMMIT_ORDER' AND p.purpose='GROCERY_CHECKOUT') OR (r.reaction_type='COMMIT_AMENDMENT' AND p.purpose='ORDER_AMENDMENT'))
 AND NOT EXISTS (SELECT 1 FROM payment_refund refund WHERE refund.payment_intent_id=p.id AND (refund.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED') OR refund.next_retry_at IS NOT NULL))`;
