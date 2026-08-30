import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { reconcilePayment } from "./reconcile-payment";

const STUCK_THRESHOLD_MS = 15 * 60_000;
const BATCH_LIMIT = 10;

export type StuckReconciliationSummary = { considered: number; attempted: number };

/**
 * Asks the configured provider for authoritative state on payments that have
 * sat in a pre-commitment state past the threshold, closing the gap left by
 * lost or delayed webhooks. Each lookup flows through the same verified
 * observation path as event ingress and never fabricates success.
 */
export async function reconcileStuckPayments(
  database: D1Database,
  registry: PaymentProviderRegistry,
  now: number,
): Promise<StuckReconciliationSummary> {
  const stuck = await database
    .prepare(
      "SELECT id FROM payment_intent WHERE status IN ('INITIATED','REQUIRES_ACTION','PROCESSING') AND updated_at <= ? ORDER BY updated_at ASC LIMIT ?",
    )
    .bind(now - STUCK_THRESHOLD_MS, BATCH_LIMIT)
    .all<{ id: string }>();

  let attempted = 0;
  for (const intent of stuck.results) {
    const result = await reconcilePayment(database, registry, {
      paymentIntentId: intent.id,
      idempotencyKey: `reconcile-sweep:${intent.id}`,
      actorId: "system:scheduler",
      requestId: crypto.randomUUID(),
    });
    if (result.ok) attempted += 1;
  }
  return { considered: stuck.results.length, attempted };
}
