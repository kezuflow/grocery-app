import { isSufficientForCommitment } from "../../payments/domain/payment";
import type { PaymentDomainState } from "../../payments/domain/payment";
import { calendarDayOfMonth, nextBillingPeriodEnd } from "../domain/billing-calendar";
import { createMembershipRepository } from "../infrastructure/d1/membership-repository";

export type ApplyMembershipPaymentReactionInput = {
  reactionId: string;
  paymentIntentId: string;
  subscriptionId: string;
  canonicalPaymentState: PaymentDomainState;
};

export type MembershipReactionOutcome = {
  applied: boolean;
  reason?: "INSUFFICIENT_STATE" | "CAS_CONFLICT" | "ALREADY_APPLIED" | "APPLIED" | "ESCALATED";
};

type SubscriptionStateRow = {
  id: string;
  status: string;
  version: number;
  starts_at: number;
  trial_ends_at: number | null;
  current_period_starts_at: number | null;
  current_period_ends_at: number | null;
  nominal_billing_day: number | null;
};

/**
 * Membership side of the explicit Payments reaction contract. Only a canonical
 * Payments state sufficient under the configured commitment policy may move
 * the subscription. The subscription transition is CAS-protected on its
 * stored version — provider events never supply an expectedVersion — and a
 * lost race leaves the reaction pending for retry/reconciliation instead of
 * losing the payment linkage. Successful membership payments install or
 * advance the paid period against the nominal billing anchor; money received
 * against a subscription that can never be applied escalates visibly instead
 * of being dropped.
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
    .prepare(
      "SELECT id, status, version, starts_at, trial_ends_at, current_period_starts_at, current_period_ends_at, nominal_billing_day FROM subscription WHERE id=?",
    )
    .bind(input.subscriptionId)
    .first<SubscriptionStateRow>();
  if (!subscription) return { applied: false, reason: "CAS_CONFLICT" };

  if (subscription.status === "CANCELED" || subscription.status === "EXPIRED") {
    // Terminal aggregates never revive; received money must be visible.
    await escalateReaction(
      database,
      input.reactionId,
      "SUBSCRIPTION_TERMINATED_WITH_PAYMENT",
      input.paymentIntentId,
      now,
    );
    return { applied: false, reason: "ESCALATED" };
  }
  if (subscription.status === "PAUSED") {
    await escalateReaction(
      database,
      input.reactionId,
      "SUBSCRIPTION_PAUSED_WITH_PAYMENT",
      input.paymentIntentId,
      now,
    );
    return { applied: false, reason: "ESCALATED" };
  }
  if (subscription.status === "ACTIVE") {
    // A repeated success on an already-active membership only advances the
    // period when the paid boundary moved; replaying the same reaction is a
    // no-op once the reaction is marked SUCCEEDED.
    const pendingReaction = existing.status === "PENDING";
    if (!pendingReaction) return { applied: true, reason: "ALREADY_APPLIED" };
  }

  const repository = createMembershipRepository(database);
  const timeZone = await repository.marketTimezone();

  const recovering = subscription.status === "PAST_DUE";
  const conversion = subscription.status === "PENDING" || subscription.status === "TRIALING";
  const periodStartInstant =
    subscription.current_period_ends_at ?? subscription.trial_ends_at ?? now;
  const anchorSourceInstant = subscription.starts_at ?? periodStartInstant;
  const anchorDay =
    subscription.nominal_billing_day ??
    calendarDayOfMonth(new Date(anchorSourceInstant).toISOString(), timeZone);
  let periodEndInstant: number;
  try {
    periodEndInstant = Date.parse(
      nextBillingPeriodEnd(anchorDay, new Date(periodStartInstant).toISOString(), timeZone),
    );
  } catch {
    // A misconfigured market timezone must not lose the payment linkage.
    await database
      .prepare(
        "UPDATE payment_reaction SET attempts=attempts+1, last_error_code='MARKET_TIMEZONE_INVALID', available_at=?, updated_at=? WHERE id=? AND status='PENDING'",
      )
      .bind(now + 60_000, now, input.reactionId)
      .run();
    return { applied: false, reason: "CAS_CONFLICT" };
  }

  const eventType = recovering
    ? "RECOVERED_FROM_PAYMENT"
    : conversion
      ? "ACTIVATED_FROM_PAYMENT"
      : "PERIOD_ADVANCED_FROM_PAYMENT";

  const applied = await database
    .prepare(
      "UPDATE subscription SET status='ACTIVE', current_period_starts_at=?, current_period_ends_at=?, nominal_billing_day=?, billing_starts_at=COALESCE(billing_starts_at, ?), grace_ends_at=NULL, cancel_at_period_end=0, cancellation_requested_at=NULL, scheduled_cancellation_at=NULL, version=version+1, updated_at=? WHERE id=? AND version=? AND status=?",
    )
    .bind(
      periodStartInstant,
      periodEndInstant,
      anchorDay,
      now,
      now,
      subscription.id,
      subscription.version,
      subscription.status,
    )
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
        "INSERT INTO subscription_event (id, subscription_id, event_type, payment_intent_id, actor_type, details_json, occurred_at, created_at) VALUES (?, ?, ?, ?, 'SYSTEM', ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        subscription.id,
        eventType,
        input.paymentIntentId,
        JSON.stringify({
          periodStartsAt: new Date(periodStartInstant).toISOString(),
          periodEndsAt: new Date(periodEndInstant).toISOString(),
          nominalBillingDay: anchorDay,
        }),
        now,
        now,
      ),
    database
      .prepare(
        "UPDATE payment_reaction SET status='SUCCEEDED', attempts=attempts+1, updated_at=? WHERE id=?",
      )
      .bind(now, input.reactionId),
  ]);
  return { applied: true, reason: "APPLIED" };
}

async function escalateReaction(
  database: D1Database,
  reactionId: string,
  errorCode: string,
  paymentIntentId: string,
  now: number,
): Promise<void> {
  await database.batch([
    database
      .prepare(
        "UPDATE payment_reaction SET status='ESCALATED', attempts=attempts+1, last_error_code=?, updated_at=? WHERE id=? AND status='PENDING'",
      )
      .bind(errorCode, now, reactionId),
    database
      .prepare(
        "INSERT INTO payment_reconciliation_case (id, payment_intent_id, category, status, details_json, created_at) VALUES (?, ?, 'REACTION_FAILURE', 'OPEN', ?, ?)",
      )
      .bind(crypto.randomUUID(), paymentIntentId, JSON.stringify({ errorCode, reactionId }), now),
  ]);
}
