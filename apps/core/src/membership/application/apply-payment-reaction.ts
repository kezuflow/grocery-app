import { isSufficientForCommitment } from "../../payments/domain/payment";
import type { PaymentDomainState } from "../../payments/domain/payment";

export type ApplyMembershipPaymentReactionInput = {
  reactionId: string;
  paymentIntentId: string;
  subscriptionId: string;
  canonicalPaymentState: PaymentDomainState;
};

export type MembershipReactionOutcome = {
  applied: boolean;
  reason?: "INSUFFICIENT_STATE" | "CAS_CONFLICT" | "ALREADY_APPLIED" | "APPLIED";
};

/**
 * Membership side of the explicit Payments reaction contract. Only a canonical
 * Payments state sufficient under the configured commitment policy may move
 * the subscription to ACTIVE. The subscription transition is CAS-protected on
 * its stored version — provider events never supply an expectedVersion — and
 * a lost race leaves the reaction pending for retry/reconciliation instead of
 * losing the payment linkage.
 */
export async function applyMembershipPaymentReaction(
  database: D1Database,
  input: ApplyMembershipPaymentReactionInput,
): Promise<MembershipReactionOutcome> {
  const now = Date.now();

  const existing = await database
    .prepare("SELECT status FROM payment_reaction WHERE id=?")
    .bind(input.reactionId)
    .first<{ status: string }>();
  if (!existing) return { applied: false, reason: "INSUFFICIENT_STATE" };
  if (existing.status === "SUCCEEDED") return { applied: true, reason: "ALREADY_APPLIED" };

  if (!isSufficientForCommitment(input.canonicalPaymentState)) {
    // Keep the reaction pending; a later observation may still complete it.
    return { applied: false, reason: "INSUFFICIENT_STATE" };
  }

  const subscription = await database
    .prepare("SELECT id, status, version FROM subscription WHERE id=?")
    .bind(input.subscriptionId)
    .first<{ id: string; status: string; version: number }>();
  if (!subscription) return { applied: false, reason: "CAS_CONFLICT" };

  const legalFrom =
    subscription.status === "PENDING" ||
    subscription.status === "TRIALING" ||
    subscription.status === "PAST_DUE";
  if (!legalFrom && subscription.status !== "ACTIVE") {
    await markReactionFailed(database, input.reactionId, "ILLEGAL_SUBSCRIPTION_STATE", now);
    return { applied: false, reason: "CAS_CONFLICT" };
  }
  if (subscription.status === "ACTIVE") {
    await markReactionSucceeded(database, input.reactionId, now);
    return { applied: true, reason: "ALREADY_APPLIED" };
  }

  const applied = await database
    .prepare(
      "UPDATE subscription SET status='ACTIVE', billing_starts_at=?, cancel_at_period_end=0, cancellation_requested_at=NULL, scheduled_cancellation_at=NULL, version=version+1, updated_at=? WHERE id=? AND version=? AND status=?",
    )
    .bind(now, now, subscription.id, subscription.version, subscription.status)
    .run()
    .then((result) => (result.meta?.changes ?? 0) === 1);

  if (!applied) {
    // Concurrent lifecycle command won the race; leave the reaction for retry.
    await database
      .prepare(
        "UPDATE payment_reaction SET attempts=attempts+1, last_error_code='CAS_CONFLICT', available_at=?, updated_at=? WHERE id=? AND status='PENDING'",
      )
      .bind(now + 60_000, now, input.reactionId)
      .run();
    return { applied: false, reason: "CAS_CONFLICT" };
  }

  await database.batch([
    database
      .prepare(
        "INSERT INTO subscription_event (id, subscription_id, event_type, payment_intent_id, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, 'ACTIVATED_FROM_PAYMENT', ?, 'SYSTEM', '{}', ?, ?)",
      )
      .bind(crypto.randomUUID(), subscription.id, input.paymentIntentId, now, now),
    markReactionSucceededStatement(database, input.reactionId, now),
  ]);
  return { applied: true, reason: "APPLIED" };
}

function markReactionSucceededStatement(database: D1Database, reactionId: string, now: number) {
  return database
    .prepare(
      "UPDATE payment_reaction SET status='SUCCEEDED', attempts=attempts+1, updated_at=? WHERE id=?",
    )
    .bind(now, reactionId);
}

async function markReactionSucceeded(database: D1Database, reactionId: string, now: number) {
  await markReactionSucceededStatement(database, reactionId, now).run();
}

async function markReactionFailed(
  database: D1Database,
  reactionId: string,
  errorCode: string,
  now: number,
): Promise<void> {
  await database
    .prepare(
      "UPDATE payment_reaction SET attempts=attempts+1, last_error_code=?, updated_at=? WHERE id=?",
    )
    .bind(errorCode, now, reactionId)
    .run();
}
