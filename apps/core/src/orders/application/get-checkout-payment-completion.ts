import type { CheckoutPaymentCompletionView, RpcResult } from "@freshmarkets/contracts";

type Query = {
  customerId: string;
  paymentIntentId: string;
  requestId: string;
};

type Row = {
  payment_intent_id: string;
  payment_status: string;
  order_id: string | null;
};

/** Customer-owned projection used while a provider payment page is open. */
export async function getCheckoutPaymentCompletion(
  database: D1Database,
  query: Query,
): Promise<RpcResult<CheckoutPaymentCompletionView>> {
  const row = await database
    .prepare(
      `SELECT payment.id AS payment_intent_id,
              payment.status AS payment_status,
              committed.order_id
       FROM payment_intent payment
       LEFT JOIN order_payment_reaction committed ON committed.payment_intent_id=payment.id
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

  return {
    ok: true,
    requestId: query.requestId,
    value: {
      paymentIntentId: row.payment_intent_id,
      state,
      orderId: state === "COMPLETED" ? row.order_id : null,
    },
  };
}
