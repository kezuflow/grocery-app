import { applyObservationToIntents, type ObservationApplication } from "./apply-observation";
import { extendPaymentRepositoryForRefunds } from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { synchronizeOrderCancellationForPayment } from "../../orders/application/advance-order-cancellation";

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

  // Recovery of a persisted Refund must also run when the Payment itself is
  // already consistent or its provider lookup is temporarily unavailable.
  await synchronizeOrderCancellationForPayment(database, intent.id);

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

  const provider = registry.get(attempt.provider);
  let view: Awaited<ReturnType<NonNullable<typeof provider>["getPayment"]>> = null;
  try {
    view = provider ? await provider.getPayment(attempt.provider_reference) : null;
  } catch {
    /* Provider availability is a recoverable observation failure, never financial failure. */
  }

  if (
    !view ||
    view.providerReference !== attempt.provider_reference ||
    view.amountMinor !== intent.amountMinor ||
    view.currency !== intent.currency
  ) {
    await repository.recordReconciliationCase({
      intentId: intent.id,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({
        reason: !view ? "PROVIDER_LOOKUP_UNAVAILABLE" : "PROVIDER_LOOKUP_IDENTITY_MISMATCH",
      }),
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

  const application = await applyObservationToIntents(database, [intent], view.canonicalState, {
    provider: attempt.provider,
    ...view,
  });
  await synchronizeOrderCancellationForPayment(database, intent.id);
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
