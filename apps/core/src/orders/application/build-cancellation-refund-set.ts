export type CancellationRefundMemberInput = {
  paymentIntentId: string;
  requiredAmountMinor: number;
  currency: string;
  source: "ORDER" | "AMENDMENT";
};

export type CancellationRefundSet = {
  grossPaidMinor: number;
  currency: string;
  members: readonly CancellationRefundMemberInput[];
};

/** Resolve the immutable paid set owned by an Order. */
export async function buildCancellationRefundSet(
  database: D1Database,
  orderId: string,
  retainedServiceFeeMinor: number,
): Promise<CancellationRefundSet | null> {
  const primary = await database
    .prepare(
      `SELECT opr.payment_intent_id, pi.amount_minor, pi.currency
       FROM order_payment_reaction opr
       JOIN payment_intent pi ON pi.id=opr.payment_intent_id
       WHERE opr.order_id=? AND pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')`,
    )
    .bind(orderId)
    .first<{ payment_intent_id: string; amount_minor: number; currency: string }>();
  if (!primary) return null;
  const amendments = await database
    .prepare(
      `SELECT a.payment_intent_id, pi.amount_minor, pi.currency
       FROM paid_order_amendment a
       JOIN payment_intent pi ON pi.id=a.payment_intent_id
       WHERE a.order_id=? AND a.status='COMMITTED'
         AND pi.status IN ('SUCCEEDED','PARTIALLY_REFUNDED')
       ORDER BY a.created_at, a.id`,
    )
    .bind(orderId)
    .all<{ payment_intent_id: string; amount_minor: number; currency: string }>();
  if (amendments.results.some((row) => row.currency !== primary.currency)) return null;
  if (retainedServiceFeeMinor > primary.amount_minor) return null;
  const members: CancellationRefundMemberInput[] = [];
  const primaryRefund = primary.amount_minor - retainedServiceFeeMinor;
  if (primaryRefund > 0)
    members.push({
      paymentIntentId: primary.payment_intent_id,
      requiredAmountMinor: primaryRefund,
      currency: primary.currency,
      source: "ORDER",
    });
  for (const amendment of amendments.results)
    if (amendment.amount_minor > 0)
      members.push({
        paymentIntentId: amendment.payment_intent_id,
        requiredAmountMinor: amendment.amount_minor,
        currency: amendment.currency,
        source: "AMENDMENT",
      });
  return {
    grossPaidMinor:
      primary.amount_minor + amendments.results.reduce((sum, row) => sum + row.amount_minor, 0),
    currency: primary.currency,
    members,
  };
}
