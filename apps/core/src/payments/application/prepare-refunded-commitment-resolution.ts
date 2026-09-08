import { completeRefundedCommitmentStatements } from "../../orders/application/complete-refunded-commitment";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { refundedCommitmentResolutionEvidence } from "../infrastructure/d1/reconciliation-resolution";

/** Financial case resolution composes owning cleanup only after guarded full-refund evidence. */
export async function prepareRefundedCommitmentResolution(
  database: D1Database,
  input: {
    caseId: string;
    expectedVersion: number;
    actorAuthUserId: string;
    reason: string;
    idempotencyKey: string;
    requestId: string;
    now: number;
  },
): Promise<D1PreparedStatement[]> {
  const row = await database
    .prepare(
      `SELECT p.id payment_id,p.version payment_version,p.customer_id,p.subject_type,p.subject_id,r.id reaction_id FROM payment_reconciliation_case c JOIN payment_intent p ON p.id=c.payment_intent_id JOIN payment_reaction r ON r.payment_intent_id=p.id AND r.id=CASE WHEN json_valid(c.details_json) THEN json_extract(c.details_json,'$.reactionId') END WHERE c.id=?`,
    )
    .bind(input.caseId)
    .first<{
      payment_id: string;
      payment_version: number;
      customer_id: string;
      subject_type: string;
      subject_id: string;
      reaction_id: string;
    }>();
  if (
    !row ||
    (row.subject_type !== "checkout_quote" && row.subject_type !== "paid_order_amendment")
  )
    return [database.prepare("INSERT INTO commitment_abort(id) VALUES (-42)")];
  const key = `${input.idempotencyKey}:refunded-commitment`;
  return [
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM payment_reconciliation_case WHERE id=? AND version=? AND status='OPEN' AND ${refundedCommitmentResolutionEvidence}) OR NOT EXISTS (SELECT 1 FROM payment_intent WHERE id=? AND version=?)`,
      )
      .bind(input.caseId, input.expectedVersion, row.payment_id, row.payment_version),
    ...completeRefundedCommitmentStatements(database, {
      paymentIntentId: row.payment_id,
      reactionId: row.reaction_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      customerId: row.customer_id,
      actorAuthUserId: input.actorAuthUserId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
      now: input.now,
    }),
    database
      .prepare(
        "UPDATE payment_reaction SET status='FAILED',last_error_code='REFUNDED_WITHOUT_COMMITMENT',updated_at=? WHERE id=? AND payment_intent_id=? AND status IN ('ESCALATED','FAILED')",
      )
      .bind(input.now, row.reaction_id, row.payment_id),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -42 WHERE changes()!=1"),
    database
      .prepare(
        "UPDATE payment_provider_action SET status='EXPIRED' WHERE payment_intent_id=? AND status='ACTIVE'",
      )
      .bind(row.payment_id),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM payment_provider_action WHERE payment_intent_id=? AND status='ACTIVE')",
      )
      .bind(row.payment_id),
    auditEventStatement(database, {
      actorUserId: input.actorAuthUserId,
      action: "PAYMENT.REFUNDED_COMMITMENT_CONFIRMED",
      resourceType: "payment_intent",
      resourceId: row.payment_id,
      reason: input.reason,
      idempotencyKey: key,
      correlationId: input.requestId,
      occurredAt: input.now,
      details: { reactionId: row.reaction_id, caseId: input.caseId },
      after: { reactionStatus: "FAILED", outcome: "REFUNDED_WITHOUT_COMMITMENT" },
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='PAYMENT.REFUNDED_COMMITMENT_CONFIRMED' AND idempotency_key=?)",
      )
      .bind(row.payment_id, key),
  ];
}
