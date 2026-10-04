import type {
  CustomerIncompleteCheckoutsView,
  PaymentActionView,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { scheduledQrGenerationEndsAt } from "../../payments/domain/qr-generation";

const PAGE_SIZE = 25;
const cursorSchema = z.object({
  version: z.literal(1),
  customerId: z.string(),
  createdAt: z.number().int().safe(),
  id: z.string().min(1).max(200),
});

/** Customer-owned checkout payments that have not produced an Order yet. */
export async function listCustomerIncompleteCheckouts(
  database: D1Database,
  input: { customerId: string; requestId: string; cursor?: string },
  now = Date.now(),
): Promise<RpcResult<CustomerIncompleteCheckoutsView>> {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (input.cursor !== undefined) {
    try {
      cursor = cursorSchema.parse(JSON.parse(input.cursor));
      if (cursor.customerId !== input.customerId) throw new Error("Invalid cursor owner");
    } catch {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid checkout page",
          requestId: input.requestId,
        },
      };
    }
  }
  const rows = await database
    .prepare(`SELECT p.id payment_intent_id,p.subject_id checkout_attempt_id,p.status,p.created_at,
      p.amount_minor,p.currency,q.fulfillment_mode,q.lines_json,q.cycle_snapshot_json,
      p.payment_method_token,
      a.action_type,a.redirect_url,a.client_token,a.expires_at
    FROM payment_intent p
    JOIN checkout_quote q ON p.subject_type='checkout_quote' AND q.id=p.subject_id AND q.customer_id=p.customer_id
    LEFT JOIN payment_provider_action a ON a.payment_intent_id=p.id AND a.status='ACTIVE' AND a.expires_at>?
    WHERE p.customer_id=? AND p.purpose='GROCERY_CHECKOUT'
      AND p.status IN ('INITIATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED')
      AND NOT EXISTS (SELECT 1 FROM order_payment_reaction committed WHERE committed.payment_intent_id=p.id)
      AND (? IS NULL OR p.created_at < ? OR (p.created_at = ? AND p.id < ?))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`)
    .bind(
      now,
      input.customerId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      PAGE_SIZE + 1,
    )
    .all<{
      payment_intent_id: string;
      checkout_attempt_id: string;
      status: "INITIATED" | "REQUIRES_ACTION" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
      created_at: number;
      amount_minor: number;
      currency: string;
      payment_method_token: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      lines_json: string;
      cycle_snapshot_json: string | null;
      action_type: "REDIRECT" | "SDK" | null;
      redirect_url: string | null;
      client_token: string | null;
      expires_at: number | null;
    }>();

  const page = rows.results.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      items: page.map((row) => {
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
        let qrGenerationEndsAt: string | null = null;
        if (row.fulfillment_mode === "SCHEDULED" && row.cycle_snapshot_json) {
          try {
            qrGenerationEndsAt = scheduledQrGenerationEndsAt(JSON.parse(row.cycle_snapshot_json));
          } catch {
            // Core's current generation decision fails closed for invalid retained evidence.
          }
        }
        const action: PaymentActionView = {
          paymentIntentId: row.payment_intent_id,
          state: row.status,
          paymentMethod: row.payment_method_token
            ? { kind: "TOKEN", value: row.payment_method_token }
            : null,
          actionType: hasAction ? row.action_type! : "NONE",
          redirectUrl: hasAction ? row.redirect_url : null,
          clientToken: hasAction ? row.client_token : null,
          expiresAt: hasAction ? new Date(row.expires_at!).toISOString() : null,
          qrGenerationEndsAt,
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
      nextCursor:
        rows.results.length > PAGE_SIZE && last
          ? JSON.stringify({
              version: 1,
              customerId: input.customerId,
              createdAt: last.created_at,
              id: last.payment_intent_id,
            })
          : null,
    },
  };
}
