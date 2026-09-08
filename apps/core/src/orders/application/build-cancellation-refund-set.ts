import { z } from "@freshmarkets/validation";
export type CancellationRefundMemberInput = {
  paymentIntentId: string;
  requiredAmountMinor: number;
  capturedAmountMinor: number;
  refundedMinor: number;
  paymentVersion: number;
  paymentStatus: string;
  currency: string;
  source: "ORDER" | "AMENDMENT";
};
export type CancellationRefundSet = {
  grossPaidMinor: number;
  previouslyRefundedMinor: number;
  remainingPaidMinor: number;
  currency: string;
  members: readonly CancellationRefundMemberInput[];
};
const paidRowsSchema = z.array(
  z.object({
    payment_intent_id: z.string().min(1),
    amount_minor: z.number().int().safe().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"]),
    version: z.number().int().safe().positive(),
    refunded_minor: z.number().int().safe().nonnegative(),
    unresolved: z.number().int().min(0).max(1),
    source: z.enum(["ORDER", "AMENDMENT"]),
  }),
);
/** Preserve the complete paid set, including fully refunded members; reserve only its remaining value. */
export async function buildCancellationRefundSet(
  database: D1Database,
  orderId: string,
  retainedServiceFeeMinor: number,
): Promise<CancellationRefundSet | null> {
  const rows = await database
    .prepare(`SELECT paid.payment_intent_id,paid.source,pi.amount_minor,pi.currency,pi.status,pi.version,
   COALESCE((SELECT SUM(r.amount_minor) FROM payment_refund r WHERE r.payment_intent_id=pi.id AND r.status='SUCCEEDED'),0) refunded_minor,
   EXISTS (SELECT 1 FROM payment_refund r WHERE r.payment_intent_id=pi.id AND (r.status IN ('REQUESTED','APPROVED','PROCESSING','ESCALATED') OR r.next_retry_at IS NOT NULL)) unresolved
   FROM (SELECT payment_intent_id,'ORDER' source,0 ordinal,id FROM order_payment_reaction WHERE order_id=?
     UNION ALL SELECT payment_intent_id,'AMENDMENT' source,1 ordinal,id FROM paid_order_amendment WHERE order_id=? AND status='COMMITTED') paid
   LEFT JOIN payment_intent pi ON pi.id=paid.payment_intent_id ORDER BY paid.ordinal,paid.id`)
    .bind(orderId, orderId)
    .all<unknown>();
  const parsed = paidRowsSchema.safeParse(rows.results);
  if (!parsed.success) return null;
  const paidRows = parsed.data;
  const primary = paidRows.filter((row) => row.source === "ORDER");
  if (
    primary.length !== 1 ||
    !primary[0] ||
    !Number.isSafeInteger(retainedServiceFeeMinor) ||
    retainedServiceFeeMinor < 0
  )
    return null;
  const currency = primary[0].currency;
  if (
    paidRows.some(
      (row) =>
        !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(row.status) ||
        row.currency !== currency ||
        row.unresolved ||
        !Number.isSafeInteger(row.amount_minor) ||
        row.amount_minor <= 0 ||
        !Number.isSafeInteger(row.refunded_minor) ||
        row.refunded_minor < 0 ||
        row.refunded_minor > row.amount_minor ||
        row.status !==
          (row.refunded_minor === 0
            ? "SUCCEEDED"
            : row.refunded_minor === row.amount_minor
              ? "REFUNDED"
              : "PARTIALLY_REFUNDED"),
    )
  )
    return null;
  if (new Set(paidRows.map((row) => row.payment_intent_id)).size !== paidRows.length) return null;
  if (retainedServiceFeeMinor > primary[0].amount_minor - primary[0].refunded_minor) return null;
  const grossPaidMinor = paidRows.reduce((sum, row) => sum + row.amount_minor, 0);
  const previouslyRefundedMinor = paidRows.reduce((sum, row) => sum + row.refunded_minor, 0);
  if (!Number.isSafeInteger(grossPaidMinor) || !Number.isSafeInteger(previouslyRefundedMinor))
    return null;
  return {
    grossPaidMinor,
    previouslyRefundedMinor,
    remainingPaidMinor: grossPaidMinor - previouslyRefundedMinor - retainedServiceFeeMinor,
    currency,
    members: paidRows.map((row) => ({
      paymentIntentId: row.payment_intent_id,
      requiredAmountMinor:
        row.amount_minor -
        row.refunded_minor -
        (row.source === "ORDER" ? retainedServiceFeeMinor : 0),
      capturedAmountMinor: row.amount_minor,
      refundedMinor: row.refunded_minor,
      paymentVersion: row.version,
      paymentStatus: row.status,
      currency: row.currency,
      source: row.source,
    })),
  };
}
