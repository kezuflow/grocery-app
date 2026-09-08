import { applyMembershipPaymentReaction } from "../../membership/application/apply-payment-reaction";
import { applyCheckoutPaymentReaction } from "../../orders/application/apply-checkout-payment-reaction";
import { applyAmendmentPaymentReaction } from "../../orders/application/apply-amendment-payment-reaction";
import { paymentDomainStates, type PaymentDomainState } from "../domain/payment";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
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

function canonicalStateOf(intentStatus: string): PaymentDomainState | undefined {
  return paymentDomainStates.find((state) => state === intentStatus);
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
  registry: PaymentProviderRegistry,
  now: number,
): Promise<RedriveSummary> {
  const exhausted = await database
    .prepare(
      "SELECT id, payment_intent_id FROM payment_reaction WHERE status='PENDING' AND attempts >= ? AND COALESCE(available_at,0)<=? LIMIT ?",
    )
    .bind(REACTION_MAX_ATTEMPTS, now, BATCH_LIMIT)
    .all<{ id: string; payment_intent_id: string }>();
  let escalated = 0;
  for (const reaction of exhausted.results) {
    escalated += await escalateReaction(
      database,
      reaction.id,
      reaction.payment_intent_id,
      "MAX_ATTEMPTS_EXCEEDED",
      now,
    );
  }
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
    // Persist an attempt and a bounded lease before invoking an owning applier.
    // Worker termination still leaves retry/exhaustion evidence and concurrent
    // sweeps cannot both execute the same due attempt.
    const claimed = await database
      .prepare(`UPDATE payment_reaction SET attempts=attempts+1,available_at=?,updated_at=?
      WHERE id=? AND status='PENDING' AND attempts=? AND COALESCE(available_at,0)<=?`)
      .bind(now + 5 * 60_000, now, reaction.id, reaction.attempts, now)
      .run();
    if (claimed.meta.changes !== 1) continue;
    const intent = await database
      .prepare("SELECT status FROM payment_intent WHERE id=?")
      .bind(reaction.payment_intent_id)
      .first<{ status: string }>();
    if (!intent) {
      escalated += await escalateReaction(
        database,
        reaction.id,
        reaction.payment_intent_id,
        "INTENT_MISSING",
        now,
      );
      continue;
    }
    const canonicalPaymentState = canonicalStateOf(intent.status);
    if (!canonicalPaymentState) {
      escalated += await escalateReaction(
        database,
        reaction.id,
        reaction.payment_intent_id,
        "PAYMENT_STATE_INVALID",
        now,
      );
      continue;
    }
    const input = {
      reactionId: reaction.id,
      paymentIntentId: reaction.payment_intent_id,
      canonicalPaymentState,
    } as const;
    let outcome: { applied: boolean; reason?: string };
    try {
      outcome =
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
    } catch {
      outcome = { applied: false, reason: "APPLICATION_FAILURE" };
    }
    if (outcome.applied) {
      await database
        .prepare(
          "UPDATE payment_reaction SET status='SUCCEEDED',updated_at=?,last_error_code=NULL WHERE id=? AND status='PENDING'",
        )
        .bind(now, reaction.id)
        .run();
      applied += 1;
      continue;
    }
    const failureReason = outcome.reason ?? "APPLICATION_FAILURE";
    await database
      .prepare(`UPDATE payment_reaction SET last_error_code=?,available_at=?,updated_at=?
      WHERE id=? AND status='PENDING' AND attempts=?`)
      .bind(
        failureReason,
        now + Math.min(15 * 60_000, 30_000 * 2 ** reaction.attempts),
        now,
        reaction.id,
        reaction.attempts + 1,
      )
      .run();
    const afterAttempt = await database
      .prepare("SELECT attempts FROM payment_reaction WHERE id=? AND status='PENDING'")
      .bind(reaction.id)
      .first<{ attempts: number }>();
    if ((afterAttempt?.attempts ?? 0) >= REACTION_MAX_ATTEMPTS) {
      escalated += await escalateReaction(
        database,
        reaction.id,
        reaction.payment_intent_id,
        "MAX_ATTEMPTS_EXCEEDED",
        now,
      );
      continue;
    }
    if (failureReason !== "INSUFFICIENT_STATE") {
      retried += 1;
      continue;
    }
    // The canonical state is still insufficient: ask the provider once so a
    // lost webhook cannot strand the reaction. The next sweep re-applies.
    try {
      const reconciliation = await reconcilePayment(database, registry, {
        paymentIntentId: reaction.payment_intent_id,
        idempotencyKey: `redrive:${reaction.id}:${reaction.attempts}`,
        actorId: "system:scheduler",
        requestId: crypto.randomUUID(),
      });
      if (
        !reconciliation.ok ||
        reconciliation.value.processingStatus === "RECONCILIATION_REQUIRED"
      ) {
        await database
          .prepare(
            "UPDATE payment_reaction SET last_error_code='PROVIDER_LOOKUP_FAILED',updated_at=? WHERE id=? AND status='PENDING' AND attempts=?",
          )
          .bind(now, reaction.id, reaction.attempts + 1)
          .run();
        retried += 1;
      } else reconciled += 1;
    } catch {
      await database
        .prepare(
          "UPDATE payment_reaction SET last_error_code='PROVIDER_LOOKUP_FAILED',updated_at=? WHERE id=? AND status='PENDING'",
        )
        .bind(now, reaction.id)
        .run();
      retried += 1;
    }
  }
  return { applied, retried, reconciled, escalated };
}

async function escalateReaction(
  database: D1Database,
  reactionId: string,
  paymentIntentId: string,
  errorCode: string,
  now: number,
): Promise<number> {
  const [updated] = await database.batch([
    database
      .prepare(
        "UPDATE payment_reaction SET status='ESCALATED', last_error_code=?, updated_at=? WHERE id=? AND status='PENDING'",
      )
      .bind(errorCode, now, reactionId),
    database
      .prepare(
        "INSERT INTO payment_reconciliation_case (id, payment_intent_id, category, status, details_json, created_at) SELECT ?, ?, 'REACTION_FAILURE', 'OPEN', ?, ? WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), paymentIntentId, JSON.stringify({ reactionId, errorCode }), now),
  ]);
  return updated?.meta?.changes ?? 0;
}
