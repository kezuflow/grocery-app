import { requestRefund } from "../../payments/application/request-refund";
import type { ScheduledJob } from "../types";

/** Captured checkout money discovered after the Scheduled demand freeze is refunded. */
export const scheduledLateCaptureRefundsJob: ScheduledJob = {
  name: "scheduled-late-capture-refunds",
  async run({
    database,
    registry,
  }): Promise<{ status: "SUCCEEDED" | "FAILED"; affected: number; errorCode?: string }> {
    const rows = await database
      .prepare(`SELECT DISTINCT p.id,p.amount_minor amountMinor
      FROM finance_exception e JOIN payment_intent p ON p.id=e.payment_intent_id
      WHERE e.status='OPEN' AND e.kind='CYCLE_CLOSED' AND p.purpose='GROCERY_CHECKOUT'
        AND p.subject_type='checkout_quote' AND p.status='SUCCEEDED'
        AND EXISTS(SELECT 1 FROM payment_attempt a WHERE a.payment_intent_id=p.id AND a.status='SUCCEEDED')
        AND NOT EXISTS(SELECT 1 FROM order_payment_reaction link WHERE link.payment_intent_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM payment_refund refund WHERE refund.payment_intent_id=p.id)
      ORDER BY p.id LIMIT 5`)
      .all<{ id: string; amountMinor: number }>();
    let affected = 0;
    let failed = false;
    for (const row of rows.results) {
      const result = await requestRefund(database, registry, {
        paymentIntentId: row.id,
        amountMinor: row.amountMinor,
        reason: "Scheduled checkout paid after settlement; no order was created",
        idempotencyKey: `scheduled-late-capture:${row.id}`,
        actorId: "system:scheduled-late-capture",
        requestId: crypto.randomUUID(),
      });
      if (result.ok) affected += 1;
      else failed = true;
    }
    return failed
      ? { status: "FAILED", affected, errorCode: "LATE_CAPTURE_REFUND_FAILED" }
      : { status: "SUCCEEDED", affected };
  },
};
