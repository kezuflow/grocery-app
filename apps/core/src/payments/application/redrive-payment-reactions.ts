import { applyMembershipPaymentReaction } from "../../membership/application/apply-payment-reaction";
import { applyCheckoutPaymentReaction } from "../../orders/application/apply-checkout-payment-reaction";
import { applyAmendmentPaymentReaction } from "../../orders/application/apply-amendment-payment-reaction";
import type { PaymentDomainState } from "../domain/payment";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { reconcilePayment } from "./reconcile-payment";

const REACTION_MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 25;

export type RedriveSummary = {
  applied: number;
  retried: number;
  reconciled: number;
  escalated: number;
};

type PendingReactionRow = {
  id: string;
  reaction_type: "ACTIVATE_MEMBERSHIP" | "RECOVER_MEMBERSHIP" | "COMMIT_ORDER" | "COMMIT_AMENDMENT";
  payment_intent_id: string;
  subject_id: string;
  attempts: number;
};

function canonicalStateOf(intentStatus: string): PaymentDomainState {
  return intentStatus as PaymentDomainState;
}

/**
 * Time-driven retry of pending Payments reactions. Reactions whose attempts
 * are exhausted become visible ESCALATED finance exceptions; due reactions
 * re-run through their owning applier under its normal CAS/idempotency
 * semantics, and an insufficient canonical state triggers one provider-lookup
 * reconciliation so a lost webhook cannot strand the reaction forever.
 */
export async function redrivePaymentReactions(
  database: D1Database,
  registry: ProviderRegistry,
  now: number,
): Promise<RedriveSummary> {
  const escalation = await database
    .prepare(
      "UPDATE payment_reaction SET status='ESCALATED', last_error_code='MAX_ATTEMPTS_EXCEEDED', updated_at=? WHERE status='PENDING' AND attempts >= ?",
    )
    .bind(now, REACTION_MAX_ATTEMPTS)
    .run();
  let escalated = escalation.meta?.changes ?? 0;
  let applied = 0;
  let retried = 0;
  let reconciled = 0;

  const due = await database
    .prepare(
      "SELECT id, reaction_type, payment_intent_id, subject_id, attempts FROM payment_reaction WHERE status='PENDING' AND COALESCE(available_at, 0) <= ? AND attempts < ? ORDER BY COALESCE(available_at, 0) ASC LIMIT ?",
    )
    .bind(now, REACTION_MAX_ATTEMPTS, BATCH_LIMIT)
    .all<PendingReactionRow>();

  for (const reaction of due.results) {
    const intent = await database
      .prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(reaction.payment_intent_id)
      .first<{ status: string }>();
    if (!intent) {
      await database
        .prepare(
          "UPDATE payment_reaction SET status='ESCALATED', last_error_code='INTENT_MISSING', updated_at=? WHERE id=? AND status='PENDING'",
        )
        .bind(now, reaction.id)
        .run();
      escalated += 1;
      continue;
    }
    const canonicalPaymentState = canonicalStateOf(intent.status);
    const input = {
      reactionId: reaction.id,
      paymentIntentId: reaction.payment_intent_id,
      canonicalPaymentState,
    } as const;
    const outcome =
      reaction.reaction_type === "ACTIVATE_MEMBERSHIP" ||
      reaction.reaction_type === "RECOVER_MEMBERSHIP"
        ? await applyMembershipPaymentReaction(database, {
            ...input,
            subscriptionId: reaction.subject_id,
          })
        : reaction.reaction_type === "COMMIT_ORDER"
          ? await applyCheckoutPaymentReaction(database, {
              ...input,
              checkoutAttemptId: reaction.subject_id,
            })
          : await applyAmendmentPaymentReaction(database, {
              ...input,
              amendmentId: reaction.subject_id,
            });
    if (outcome.applied) {
      applied += 1;
      continue;
    }
    if (outcome.reason === "CAS_CONFLICT") {
      retried += 1;
      continue;
    }
    // The canonical state is still insufficient: ask the provider once so a
    // lost webhook cannot strand the reaction. The next sweep re-applies.
    await reconcilePayment(database, registry, {
      paymentIntentId: reaction.payment_intent_id,
      idempotencyKey: `redrive:${reaction.id}:${reaction.attempts}`,
      actorId: "system:scheduler",
      requestId: crypto.randomUUID(),
    });
    reconciled += 1;
  }
  return { applied, retried, reconciled, escalated };
}
