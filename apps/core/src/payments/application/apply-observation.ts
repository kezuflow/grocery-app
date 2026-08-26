import {
  findPaymentTransitionPath,
  isSufficientForCommitment,
  type PaymentDomainState,
} from "../domain/payment";
import { extendPaymentRepository } from "../infrastructure/d1/payment-repository";
import type { PaymentIntentRow } from "../infrastructure/d1/payment-repository";

export type ObservationApplication = {
  processingStatus: "APPLIED" | "RETRY_REQUIRED" | "RECONCILIATION_REQUIRED";
  paymentIntentId: string | null;
  canonicalState: PaymentDomainState;
};

function reactionTypeFor(purpose: string): string {
  switch (purpose) {
    case "MEMBERSHIP_ENROLLMENT":
    case "MEMBERSHIP_RENEWAL":
      return "ACTIVATE_MEMBERSHIP";
    case "GROCERY_CHECKOUT":
      return "COMMIT_ORDER";
    case "ORDER_AMENDMENT":
      return "COMMIT_AMENDMENT";
    default:
      return "ACTIVATE_MEMBERSHIP";
  }
}

/**
 * Apply one verified provider observation to a resolved intent using
 * handler-side compare-and-swap on the stored version. A sufficient outcome
 * writes exactly one durable downstream reaction keyed by intent and reaction
 * type, so repeated observations can never commit a subject twice.
 */
export async function applyObservationToIntents(
  database: D1Database,
  intents: readonly PaymentIntentRow[],
  canonicalState: PaymentDomainState,
): Promise<ObservationApplication> {
  const repository = extendPaymentRepository(database);
  const now = Date.now();

  if (intents.length === 0)
    return { processingStatus: "RECONCILIATION_REQUIRED", paymentIntentId: null, canonicalState };
  if (intents.length > 1) {
    await repository.recordReconciliationCase({
      intentId: intents[0].id,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({ matches: intents.length, observation: canonicalState }),
      now,
    });
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      paymentIntentId: intents[0].id,
      canonicalState,
    };
  }

  const intent = intents[0];
  if (intent.status === canonicalState)
    return { processingStatus: "APPLIED", paymentIntentId: intent.id, canonicalState };

  // Reconciliation may need to walk a lagging stored state forward through the
  // canonical machine (e.g. REQUIRES_ACTION -> PROCESSING -> SUCCEEDED).
  const path = findPaymentTransitionPath(intent.status as PaymentDomainState, canonicalState);
  if (!path) {
    await repository.recordReconciliationCase({
      intentId: intent.id,
      category: "AMBIGUOUS_OUTCOME",
      detailsJson: JSON.stringify({ from: intent.status, to: canonicalState }),
      now,
    });
    return {
      processingStatus: "RECONCILIATION_REQUIRED",
      paymentIntentId: intent.id,
      canonicalState,
    };
  }

  let version = intent.version;
  let currentStatus = intent.status;
  for (let index = 1; index < path.length; index += 1) {
    const nextStatus = path[index];
    const finalHop = index === path.length - 1;
    const sufficient = finalHop && isSufficientForCommitment(canonicalState);
    const applied = await repository.applyObservationWithReaction({
      intentId: intent.id,
      expectedVersion: version,
      expectedStatus: currentStatus,
      nextStatus,
      reaction:
        sufficient && !["PARTIALLY_REFUNDED", "REFUNDED"].includes(currentStatus)
          ? {
              reactionType: reactionTypeFor(intent.purpose),
              subjectType: intent.subjectType,
              subjectId: intent.subjectId,
              idempotencyKey: `reaction:intent:${intent.id}:${reactionTypeFor(intent.purpose)}`,
              now,
            }
          : null,
    });
    if (!applied)
      return { processingStatus: "RETRY_REQUIRED", paymentIntentId: intent.id, canonicalState };
    version += 1;
    currentStatus = nextStatus;
  }

  return { processingStatus: "APPLIED", paymentIntentId: intent.id, canonicalState };
}
