import type {
  CustomerIncompleteCheckoutsView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";

/** Customer-owned checkout payments that have not produced an Order yet. */
export async function listCustomerIncompleteCheckouts(
  database: D1Database,
  input: { customerId: string; requestId: string },
  now = Date.now(),
): Promise<RpcResult<CustomerIncompleteCheckoutsView>> {
  const rows = await database
    .prepare(`SELECT p.id payment_intent_id,p.subject_id checkout_attempt_id,p.status,p.created_at,
      p.amount_minor,p.currency,q.fulfillment_mode,q.lines_json,
      a.action_type,a.redirect_url,a.client_token,a.expires_at
    FROM payment_intent p
    JOIN checkout_quote q ON p.subject_type='checkout_quote' AND q.id=p.subject_id AND q.customer_id=p.customer_id
    LEFT JOIN payment_provider_action a ON a.payment_intent_id=p.id AND a.status='ACTIVE' AND a.expires_at>?
    WHERE p.customer_id=? AND p.purpose='GROCERY_CHECKOUT'
      AND p.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','EXPIRED')
      AND NOT EXISTS (SELECT 1 FROM order_payment_reaction committed WHERE committed.payment_intent_id=p.id)
    ORDER BY p.created_at DESC,p.id DESC LIMIT 25`)
    .bind(now, input.customerId)
    .all<{
      payment_intent_id: string;
      checkout_attempt_id: string;
      status: "INITIATED" | "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
      created_at: number;
      amount_minor: number;
      currency: string;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      lines_json: string;
      action_type: "REDIRECT" | "SDK" | null;
      redirect_url: string | null;
      client_token: string | null;
      expires_at: number | null;
    }>();

  return {
    ok: true,
    requestId: input.requestId,
    value: {
      items: rows.results.map((row) => {
        let itemCount = 0;
        try {
          const lines = JSON.parse(row.lines_json) as Array<{ quantity?: unknown }>;
          itemCount = lines.reduce(
            (sum, line) => sum + (typeof line.quantity === "number" ? line.quantity : 0),
            0,
          );
        } catch {
          // The checkout remains visible even if retained display JSON cannot be decoded.
        }
        const hasAction = row.action_type !== null && row.expires_at !== null;
        const action: PaymentActionView = {
          paymentIntentId: row.payment_intent_id,
          state: row.status,
          actionType: hasAction ? row.action_type! : "NONE",
          redirectUrl: hasAction ? row.redirect_url : null,
          clientToken: hasAction ? row.client_token : null,
          expiresAt: hasAction ? new Date(row.expires_at!).toISOString() : null,
        };
        return {
          paymentIntentId: row.payment_intent_id,
          checkoutAttemptId: row.checkout_attempt_id,
          state: row.status,
          fulfillmentMode: row.fulfillment_mode,
          submittedAt: new Date(row.created_at).toISOString(),
          totalMinor: row.amount_minor,
          currency: row.currency,
          itemCount,
          action,
        };
      }),
    },
  };
}
