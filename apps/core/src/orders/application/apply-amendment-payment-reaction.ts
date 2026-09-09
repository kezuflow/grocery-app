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
 * sufficient canonical state. Only amendment-scoped inventory or exact-demand
 * deltas are written; the original paid order's commercial history is untouched.
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
              pi.currency AS payment_currency, pi.status AS payment_status, pi.version AS payment_version, f.location_id, f.cycle_id, f.zone_id,
              f.fulfillment_mode
       FROM paid_order_amendment a
       JOIN payment_intent pi ON pi.id=a.payment_intent_id
         AND pi.purpose='ORDER_AMENDMENT' AND pi.subject_type='paid_order_amendment'
         AND pi.subject_id=a.id
       JOIN grocery_order o ON o.id=a.order_id AND o.customer_id=pi.customer_id
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
      payment_status: string;
      payment_version: number;
      location_id: string | null;
      cycle_id: string | null;
      zone_id: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
    }>();
  if (!amendment) return { applied: false, reason: "CAS_CONFLICT" };
  if (
    !(await database
      .prepare(
        "SELECT 1 FROM payment_reaction WHERE id=? AND payment_intent_id=? AND reaction_type='COMMIT_AMENDMENT' AND subject_type='paid_order_amendment' AND subject_id=?",
      )
      .bind(input.reactionId, input.paymentIntentId, input.amendmentId)
      .first())
  )
    return { applied: false, reason: "CAS_CONFLICT" };
  if (amendment.status === "COMMITTED") return { applied: true, reason: "ALREADY_APPLIED" };
  if (
    !isSufficientForCommitment(input.canonicalPaymentState) ||
    amendment.payment_status !== "SUCCEEDED"
  ) {
    return { applied: false, reason: "INSUFFICIENT_STATE" };
  }
  if (
    amendment.fulfillment_mode !== "SCHEDULED" ||
    amendment.payment_amount_minor !== amendment.total_minor ||
    amendment.payment_currency !== amendment.currency
  )
    return { applied: false, reason: "CAS_CONFLICT" };

  const lines = await database
    .prepare(
      `SELECT l.id,l.sku_id,l.quantity,l.base_quantity,l.base_unit_code_snapshot,
              l.shipping_weight_grams,COALESCE(s.stock_pool_id,p.inventory_pool_id) AS pool_id
       FROM paid_order_amendment_line l JOIN sku s ON s.id=l.sku_id
       JOIN product p ON p.id=s.product_id
       WHERE l.amendment_id=?`,
    )
    .bind(input.amendmentId)
    .all<{
      id: string;
      sku_id: string;
      quantity: number;
      base_quantity: number;
      base_unit_code_snapshot: string | null;
      shipping_weight_grams: number | null;
      pool_id: string;
    }>()
    .then((result) => result.results);

  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `UPDATE paid_order_amendment SET status='COMMITTED',version=version+1,committed_at=?,updated_at=?
        WHERE id=? AND status='PENDING_PAYMENT' AND version=? AND EXISTS
          (SELECT 1 FROM grocery_order o JOIN order_fulfillment_snapshot f ON f.order_id=o.id
           JOIN delivery_cycle c ON c.id=f.cycle_id
           WHERE o.id=paid_order_amendment.order_id AND o.status='COMMITTED'
             AND f.fulfillment_mode='SCHEDULED'
             AND f.cutoff_at>(SELECT created_at FROM payment_intent WHERE id=paid_order_amendment.payment_intent_id)
             AND c.status NOT IN ('DRAFT','SCHEDULED','CANCELED','CLOSED'))
          AND EXISTS (SELECT 1 FROM payment_intent pi WHERE pi.id=paid_order_amendment.payment_intent_id
            AND pi.status='SUCCEEDED' AND pi.version=? AND pi.purpose='ORDER_AMENDMENT' AND pi.subject_type='paid_order_amendment' AND pi.subject_id=paid_order_amendment.id
            AND pi.customer_id=(SELECT customer_id FROM grocery_order WHERE id=paid_order_amendment.order_id)
            AND pi.amount_minor=paid_order_amendment.total_minor AND pi.currency=paid_order_amendment.currency
            AND NOT EXISTS (SELECT 1 FROM payment_refund refund WHERE refund.payment_intent_id=pi.id AND (refund.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED','SUCCEEDED') OR refund.next_retry_at IS NOT NULL)))
          AND EXISTS (SELECT 1 FROM payment_reaction r WHERE r.id=? AND r.payment_intent_id=paid_order_amendment.payment_intent_id
            AND r.subject_id=paid_order_amendment.id AND r.subject_type='paid_order_amendment' AND r.reaction_type='COMMIT_AMENDMENT' AND r.status='PENDING')`,
      )
      .bind(
        now,
        now,
        input.amendmentId,
        amendment.version,
        amendment.payment_version,
        input.reactionId,
      ),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -34 WHERE changes()!=1"),
  ];

  if (amendment.fulfillment_mode === "SCHEDULED") {
    if (
      lines.length === 0 ||
      !amendment.cycle_id ||
      !amendment.location_id ||
      lines.some((line) => !line.base_unit_code_snapshot || !line.shipping_weight_grams)
    )
      return { applied: false, reason: "CAS_CONFLICT" };
    for (const line of lines) {
      statements.push(
        database
          .prepare(
            `INSERT INTO committed_demand
             (id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,
              demand_basis,amendment_line_id,sku_id,quantity_sellable,quantity_base_total,
              base_unit_code,shipping_weight_grams,committed_at)
             VALUES (?,?,?,?,?,?,'OPEN','EXACT_PAID_LINE',?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            amendment.order_id,
            amendment.cycle_id,
            amendment.location_id,
            line.pool_id,
            line.base_quantity,
            line.id,
            line.sku_id,
            line.quantity,
            line.base_quantity,
            line.base_unit_code_snapshot,
            line.shipping_weight_grams,
            now,
          ),
      );
    }
  }
  statements.push(
    database
      .prepare(
        "UPDATE payment_reaction SET status='SUCCEEDED',attempts=attempts+1,updated_at=? WHERE id=? AND status='PENDING'",
      )
      .bind(now, input.reactionId),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -34 WHERE changes()!=1"),
  );

  try {
    await database.batch(statements);
    return { applied: true, reason: "APPLIED" };
  } catch {
    const winner = await database
      .prepare(
        "SELECT id FROM paid_order_amendment WHERE id=? AND payment_intent_id=? AND status='COMMITTED'",
      )
      .bind(input.amendmentId, input.paymentIntentId)
      .first();
    if (winner) return { applied: true, reason: "ALREADY_APPLIED" };
    // The entire batch rolls back when the commitment guard loses.
    return { applied: false, reason: "CAS_CONFLICT" };
  }
}
