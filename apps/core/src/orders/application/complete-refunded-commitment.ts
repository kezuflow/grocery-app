import { releaseRefundedCheckoutStatements } from "../../checkout/application/release-refunded-checkout";
import { auditEventStatement } from "../../audit/application/append-audit-event";

/** Orders owns the non-committed outcome; Payments supplies guarded full-refund authority. */
export function completeRefundedCommitmentStatements(
  database: D1Database,
  input: {
    paymentIntentId: string;
    reactionId: string;
    subjectType: "checkout_quote" | "paid_order_amendment";
    subjectId: string;
    customerId: string;
    actorAuthUserId: string;
    reason: string;
    idempotencyKey: string;
    requestId: string;
    now: number;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM order_payment_reaction WHERE payment_intent_id=?) OR EXISTS (SELECT 1 FROM grocery_order o JOIN payment_attempt a ON a.id=o.payment_id WHERE a.payment_intent_id=?) OR EXISTS (SELECT 1 FROM paid_order_amendment WHERE payment_intent_id=? AND status='COMMITTED')`,
      )
      .bind(input.paymentIntentId, input.paymentIntentId, input.paymentIntentId),
  ];
  if (input.subjectType === "checkout_quote")
    statements.push(
      ...releaseRefundedCheckoutStatements(database, {
        quoteId: input.subjectId,
        paymentIntentId: input.paymentIntentId,
        customerId: input.customerId,
        now: input.now,
      }),
    );
  else
    statements.push(
      database
        .prepare(
          `INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM paid_order_amendment a JOIN grocery_order o ON o.id=a.order_id WHERE a.id=? AND (a.payment_intent_id IS NOT ? OR o.customer_id!=? OR a.status='COMMITTED')) OR EXISTS (SELECT 1 FROM committed_demand d JOIN paid_order_amendment_line l ON l.id=d.amendment_line_id WHERE l.amendment_id=?)`,
        )
        .bind(input.subjectId, input.paymentIntentId, input.customerId, input.subjectId),
      database
        .prepare(
          "UPDATE paid_order_amendment SET status='FAILED',version=version+1,updated_at=? WHERE id=? AND payment_intent_id=? AND status IN ('DRAFT','PENDING_PAYMENT')",
        )
        .bind(input.now, input.subjectId, input.paymentIntentId),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM paid_order_amendment WHERE id=? AND status NOT IN ('FAILED','CANCELED'))",
        )
        .bind(input.subjectId),
    );
  statements.push(
    database
      .prepare(
        "UPDATE finance_exception SET status='RESOLVED',resolved_at=? WHERE payment_intent_id=? AND reaction_id=? AND status='OPEN'",
      )
      .bind(input.now, input.paymentIntentId, input.reactionId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM finance_exception WHERE payment_intent_id=? AND reaction_id=? AND status='OPEN')",
      )
      .bind(input.paymentIntentId, input.reactionId),
    auditEventStatement(database, {
      actorUserId: input.actorAuthUserId,
      action: "ORDER.REFUNDED_COMMITMENT_CLOSED",
      resourceType: "payment_intent",
      resourceId: input.paymentIntentId,
      reason: input.reason,
      idempotencyKey: `${input.idempotencyKey}:order-cleanup`,
      correlationId: input.requestId,
      occurredAt: input.now,
      details: {
        reactionId: input.reactionId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    }),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (SELECT 1 FROM audit_event WHERE aggregate_id=? AND action='ORDER.REFUNDED_COMMITMENT_CLOSED' AND idempotency_key=?)",
      )
      .bind(input.paymentIntentId, `${input.idempotencyKey}:order-cleanup`),
  );
  return statements;
}
