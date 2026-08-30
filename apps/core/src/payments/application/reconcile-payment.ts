import { applyObservationToIntents, type ObservationApplication } from "./apply-observation";
import { extendPaymentRepositoryForRefunds } from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";

export type ReconcilePaymentCommand = {
  paymentIntentId: string;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

export type ReconciliationOutcome = ObservationApplication & {
  source: "PROVIDER_LOOKUP" | "ALREADY_CONSISTENT";
};

/**
 * Recover a payment whose webhook was lost or arrived out of order by asking
 * the configured provider for the authoritative state. The lookup result is a
 * verified observation: it flows through the same compare-and-swap and
 * reaction logic as event ingress and never fabricates `SUCCEEDED`.
 */
export async function reconcilePayment(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: ReconcilePaymentCommand,
): Promise<
  | { ok: true; value: ReconciliationOutcome; requestId: string }
  | { ok: false; error: { code: string; message: string } }
> {
  const repository = extendPaymentRepositoryForRefunds(database);
  const intent = await repository.findIntentById(command.paymentIntentId);
  if (!intent)
    return { ok: false, error: { code: "NOT_FOUND", message: "Payment intent not found" } };

  const attempt = await database
    .prepare(
      "SELECT provider, provider_reference FROM payment_attempt WHERE payment_intent_id=? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(intent.id)
    .first<{ provider: string; provider_reference: string }>();
  if (!attempt) {
    await repository.recordReconciliationCase({
      intentId: intent.id,
      category: "UNMAPPED_PROVIDER_REFERENCE",
      detailsJson: JSON.stringify({ reason: "no provider attempt linked" }),
      now: Date.now(),
    });
    return {
      ok: true,
      value: {
        processingStatus: "RECONCILIATION_REQUIRED",
        paymentIntentId: intent.id,
        canonicalState: toDomainState(intent.status),
        source: "PROVIDER_LOOKUP",
      },
      requestId: command.requestId,
    };
  }

  const provider = registry.require(attempt.provider);
  const view = await provider.getPayment(attempt.provider_reference);
  if (!view || view.canonicalState === intent.status) {
    return {
      ok: true,
      value: {
        processingStatus: view ? "APPLIED" : "RECONCILIATION_REQUIRED",
        paymentIntentId: intent.id,
        canonicalState: view?.canonicalState ?? toDomainState(intent.status),
        source: view ? "PROVIDER_LOOKUP" : "ALREADY_CONSISTENT",
      },
      requestId: command.requestId,
    };
  }

  const application = await applyObservationToIntents(database, [intent], view.canonicalState);
  return {
    ok: true,
    value: { ...application, source: "PROVIDER_LOOKUP" },
    requestId: command.requestId,
  };
}

function toDomainState(status: string): ReconciliationOutcome["canonicalState"] {
  switch (status) {
    case "INITIATED":
    case "REQUIRES_ACTION":
    case "PROCESSING":
    case "SUCCEEDED":
    case "FAILED":
    case "EXPIRED":
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return status;
    default:
      return "PROCESSING";
  }
}
