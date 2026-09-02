import { isSufficientForCommitment } from "../../payments/domain/payment";
import type { PaymentDomainState } from "../../payments/domain/payment";

export type ApplyAmendmentPaymentReactionInput = {
  reactionId: string;
  paymentIntentId: string;
  amendmentId: string;
  canonicalPaymentState: PaymentDomainState;
};

export type AmendmentReactionOutcome = {
  applied: boolean;
  reason: "APPLIED" | "ALREADY_APPLIED" | "INSUFFICIENT_STATE" | "CAS_CONFLICT";
};

/**
 * Commit an additive amendment once its own payment intent reaches a
 * sufficient canonical state. Only amendment-scoped capacity/inventory deltas
 * are written; the original paid order's commercial history is untouched.
 */
export async function applyAmendmentPaymentReaction(
  database: D1Database,
  input: ApplyAmendmentPaymentReactionInput,
): Promise<AmendmentReactionOutcome> {
  const now = Date.now();
  const amendment = await database
    .prepare(
      `SELECT a.id, a.order_id, a.status, a.version, a.currency, a.total_minor,
              a.payment_intent_id, pi.amount_minor AS payment_amount_minor,
              pi.currency AS payment_currency, f.location_id, f.cycle_id, f.zone_id,
              f.fulfillment_mode
       FROM paid_order_amendment a
       JOIN payment_intent pi ON pi.id=a.payment_intent_id
         AND pi.purpose='ORDER_AMENDMENT' AND pi.subject_type='paid_order_amendment'
         AND pi.subject_id=a.id
       LEFT JOIN order_fulfillment_snapshot f ON f.order_id=a.order_id
       WHERE a.id=? AND pi.id=?`,
    )
    .bind(input.amendmentId, input.paymentIntentId)
    .first<{
      id: string;
      order_id: string;
      status: string;
      version: number;
      currency: string;
      total_minor: number;
      payment_intent_id: string;
      payment_amount_minor: number;
      payment_currency: string;
      location_id: string | null;
      cycle_id: string | null;
      zone_id: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
    }>();
  if (!amendment) return { applied: false, reason: "CAS_CONFLICT" };
  if (amendment.status === "COMMITTED") return { applied: true, reason: "ALREADY_APPLIED" };
  if (!isSufficientForCommitment(input.canonicalPaymentState)) {
    if (["FAILED", "EXPIRED"].includes(input.canonicalPaymentState))
      await database
        .prepare(
          "UPDATE paid_order_amendment SET status='FAILED',version=version+1,updated_at=? WHERE id=? AND status='PENDING_PAYMENT' AND version=?",
        )
        .bind(now, input.amendmentId, amendment.version)
        .run();
    return { applied: false, reason: "INSUFFICIENT_STATE" };
  }
  if (
    amendment.payment_amount_minor !== amendment.total_minor ||
    amendment.payment_currency !== amendment.currency
  )
    return { applied: false, reason: "CAS_CONFLICT" };

  const lines = await database
    .prepare(
      `SELECT l.sku_id, l.quantity, l.base_quantity, p.inventory_pool_id AS pool_id
       FROM paid_order_amendment_line l JOIN sku s ON s.id=l.sku_id
       JOIN product p ON p.id=s.product_id
       WHERE l.amendment_id=?`,
    )
    .bind(input.amendmentId)
    .all<{
      sku_id: string;
      quantity: number;
      base_quantity: number;
      pool_id: string;
    }>()
    .then((result) => result.results);

  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        "UPDATE paid_order_amendment SET status='COMMITTED',version=version+1,committed_at=?,updated_at=? WHERE id=? AND status='PENDING_PAYMENT' AND version=?",
      )
      .bind(now, now, input.amendmentId, amendment.version),
  ];

  const perPool = new Map<string, number>();
  for (const line of lines) {
    perPool.set(line.pool_id, (perPool.get(line.pool_id) ?? 0) + line.base_quantity);
  }
  for (const [poolId, requested] of perPool) {
    const reserved = amendment.fulfillment_mode === "INSTANT" ? requested : 0;
    const planned = amendment.fulfillment_mode === "SCHEDULED" ? requested : 0;
    if (reserved > 0) {
      statements.push(
        database
          .prepare(
            "UPDATE inventory_balance SET reserved=reserved+?, version=version+1 WHERE location_id=? AND inventory_pool_id=? AND on_hand-reserved>=?",
          )
          .bind(reserved, amendment.location_id ?? "", poolId, reserved),
        database
          .prepare(
            "INSERT INTO inventory_reservation (id, order_id, location_id, inventory_pool_id, quantity, status) SELECT ?, ?, ?, ?, ?, 'RESERVED' WHERE changes()=1",
          )
          .bind(
            crypto.randomUUID(),
            `${amendment.order_id}`,
            amendment.location_id ?? "",
            poolId,
            reserved,
          ),
      );
    }
    if (planned > 0) {
      statements.push(
        database
          .prepare(
            "INSERT INTO committed_demand (id, order_id, delivery_cycle_id, location_id, inventory_pool_id, quantity, status) VALUES (?, ?, ?, ?, ?, ?, 'OPEN')",
          )
          .bind(
            crypto.randomUUID(),
            `${amendment.order_id}`,
            amendment.cycle_id ?? "",
            amendment.location_id ?? "",
            poolId,
            planned,
          ),
      );
    }
  }
  void isSufficientForCommitment;

  try {
    await database.batch(statements);
    return { applied: true, reason: "APPLIED" };
  } catch {
    // Concurrent change: the PENDING_PAYMENT guard loses the race.
    return { applied: false, reason: "CAS_CONFLICT" };
  }
}
