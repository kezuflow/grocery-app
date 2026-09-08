/** Repair the Orders exception projection only from an actual committed payment link. */
export async function prepareCommittedFinanceExceptionResolution(
  database: D1Database,
  paymentIntentId: string | null,
  now: number,
): Promise<D1PreparedStatement[]> {
  if (!paymentIntentId) return [];
  const link = await database
    .prepare(
      "SELECT order_id, reaction_id, checkout_quote_id FROM order_payment_reaction WHERE payment_intent_id=?",
    )
    .bind(paymentIntentId)
    .first<{ order_id: string; reaction_id: string; checkout_quote_id: string | null }>();
  if (!link?.checkout_quote_id) return [];
  return resolveCommittedFinanceExceptionStatements(database, {
    orderId: link.order_id,
    reactionId: link.reaction_id,
    checkoutAttemptId: link.checkout_quote_id,
    paymentIntentId,
    now,
  });
}

export function resolveCommittedFinanceExceptionStatements(
  database: D1Database,
  input: {
    orderId: string;
    paymentIntentId: string;
    reactionId: string;
    checkoutAttemptId: string;
    now: number;
  },
): D1PreparedStatement[] {
  const identity = [
    input.orderId,
    input.paymentIntentId,
    input.reactionId,
    input.checkoutAttemptId,
  ];
  return [
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE NOT EXISTS (
      SELECT 1 FROM order_payment_reaction link
      JOIN grocery_order o ON o.id=link.order_id
      JOIN payment_attempt a ON a.id=o.payment_id AND a.payment_intent_id=link.payment_intent_id
      JOIN payment_reaction r ON r.id=link.reaction_id AND r.payment_intent_id=link.payment_intent_id
      WHERE link.order_id=? AND link.payment_intent_id=? AND link.reaction_id=? AND link.checkout_quote_id=?
      AND r.status='SUCCEEDED' AND r.reaction_type='COMMIT_ORDER' AND r.subject_type='checkout_quote' AND r.subject_id=link.checkout_quote_id
    )`)
      .bind(...identity),
    database
      .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,occurred_at,correlation_id)
      SELECT 'commitment-recovered:'||e.id,NULL,'ORDER.COMMITMENT_RECOVERED','order',?,json_object('exceptionId',e.id,'paymentIntentId',e.payment_intent_id,'reactionId',e.reaction_id),'commitment-recovered:'||e.id,?,?
      FROM finance_exception e WHERE e.payment_intent_id=? AND e.reaction_id=? AND e.status='OPEN'
      AND NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.action='ORDER.COMMITMENT_RECOVERED' AND a.idempotency_key='commitment-recovered:'||e.id)
    `)
      .bind(input.orderId, input.now, input.reactionId, input.paymentIntentId, input.reactionId),
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (
      SELECT 1 FROM finance_exception e WHERE e.payment_intent_id=? AND e.reaction_id=? AND e.status='OPEN'
      AND NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.action='ORDER.COMMITMENT_RECOVERED' AND a.aggregate_id=? AND a.idempotency_key='commitment-recovered:'||e.id)
    )`)
      .bind(input.paymentIntentId, input.reactionId, input.orderId),
    database
      .prepare(
        "UPDATE finance_exception SET status='RESOLVED',order_id=?,resolved_at=? WHERE payment_intent_id=? AND reaction_id=? AND status='OPEN'",
      )
      .bind(input.orderId, input.now, input.paymentIntentId, input.reactionId),
    database
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -42 WHERE EXISTS (SELECT 1 FROM finance_exception WHERE payment_intent_id=? AND reaction_id=? AND status='OPEN')",
      )
      .bind(input.paymentIntentId, input.reactionId),
  ];
}
