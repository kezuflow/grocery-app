import type { CheckoutPaymentCompletionView, RpcResult } from "@freshmarkets/contracts";
import { scheduledQrGenerationEndsAt } from "../../payments/domain/qr-generation";

type Query = {
  customerId: string;
  paymentIntentId: string;
  requestId: string;
};

type Row = {
  payment_intent_id: string;
  payment_status: string;
  order_id: string | null;
  fulfillment_mode: "INSTANT" | "SCHEDULED" | null;
  cycle_snapshot_json: string | null;
  cycle_status: string | null;
  cutoff_at: number | null;
  action_expires_at: number | null;
};

/** Customer-owned projection used while a provider payment page is open. */
export async function getCheckoutPaymentCompletion(
  database: D1Database,
  query: Query,
  now = Date.now(),
): Promise<RpcResult<CheckoutPaymentCompletionView>> {
  const row = await database
    .prepare(
      `SELECT payment.id AS payment_intent_id,
              payment.status AS payment_status,
              committed.order_id, quote.fulfillment_mode, quote.cycle_snapshot_json,
              cycle.status AS cycle_status, cycle.cutoff_at,
              (SELECT MAX(action.expires_at) FROM payment_provider_action action
               WHERE action.payment_intent_id=payment.id AND action.status='ACTIVE') AS action_expires_at
       FROM payment_intent payment
       LEFT JOIN order_payment_reaction committed ON committed.payment_intent_id=payment.id
       LEFT JOIN checkout_quote quote ON quote.id=payment.subject_id AND quote.customer_id=payment.customer_id
       LEFT JOIN delivery_cycle cycle ON cycle.id=quote.delivery_cycle_id
       WHERE payment.id=? AND payment.customer_id=?
         AND payment.purpose='GROCERY_CHECKOUT'
         AND payment.subject_type='checkout_quote'`,
    )
    .bind(query.paymentIntentId, query.customerId)
    .first<Row>();

  if (!row)
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Checkout payment not found",
        requestId: query.requestId,
      },
    };

  const state: CheckoutPaymentCompletionView["state"] = row.order_id
    ? "COMPLETED"
    : row.payment_status === "SUCCEEDED"
      ? "FINALIZING_ORDER"
      : ["FAILED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(row.payment_status)
        ? "FAILED"
        : row.payment_status === "EXPIRED"
          ? "EXPIRED"
          : "WAITING_FOR_PAYMENT";

  let qrGenerationEndsAt: string | null = null;
  if (row.fulfillment_mode === "SCHEDULED" && row.cycle_snapshot_json) {
    try {
      qrGenerationEndsAt = scheduledQrGenerationEndsAt(JSON.parse(row.cycle_snapshot_json));
    } catch {
      // Financial status remains readable; malformed saved schedule cannot authorize a new QR.
    }
  }
  const qrGenerationAllowed =
    state === "WAITING_FOR_PAYMENT" &&
    ["INITIATED", "REQUIRES_ACTION"].includes(row.payment_status) &&
    row.action_expires_at !== null &&
    row.action_expires_at > now &&
    (row.fulfillment_mode === "INSTANT" ||
      (row.fulfillment_mode === "SCHEDULED" &&
        row.cycle_status === "OPEN" &&
        row.cutoff_at !== null &&
        row.cutoff_at > now &&
        qrGenerationEndsAt !== null &&
        Date.parse(qrGenerationEndsAt) > now));

  return {
    ok: true,
    requestId: query.requestId,
    value: {
      paymentIntentId: row.payment_intent_id,
      state,
      orderId: state === "COMPLETED" ? row.order_id : null,
      qrGenerationAllowed,
      qrGenerationEndsAt,
    },
  };
}
