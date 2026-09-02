import type { SubscriptionState } from "@freshmarkets/contracts";

export type EntitlementDecision = {
  eligible: boolean;
  state: SubscriptionState | null;
  effectiveUntil: number | null;
  reason: "ENTITLED" | "NO_SUBSCRIPTION" | "TRIAL_ENDED" | "STATE_NOT_ENTITLED";
};

type SubscriptionEntitlementRow = {
  status: SubscriptionState;
  trial_ends_at: number | null;
  current_period_ends_at: number | null;
};

/**
 * Membership-owned entitlement policy used by every checkout boundary.
 * Exact end instants are exclusive. Scheduled cancellation remains intent
 * metadata until its explicit lifecycle transition changes the state.
 */
export async function evaluateSubscriptionEntitlement(
  database: D1Database,
  input: { customerId: string; at: number },
): Promise<EntitlementDecision> {
  const subscription = await database
    .prepare(
      `SELECT status, trial_ends_at, current_period_ends_at
       FROM subscription
       WHERE customer_id=?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(input.customerId)
    .first<SubscriptionEntitlementRow>();

  if (!subscription) {
    return {
      eligible: false,
      state: null,
      effectiveUntil: null,
      reason: "NO_SUBSCRIPTION",
    };
  }

  if (subscription.status === "TRIALING") {
    const effectiveUntil = subscription.trial_ends_at;
    return effectiveUntil !== null && effectiveUntil > input.at
      ? { eligible: true, state: subscription.status, effectiveUntil, reason: "ENTITLED" }
      : {
          eligible: false,
          state: subscription.status,
          effectiveUntil,
          reason: "TRIAL_ENDED",
        };
  }

  if (subscription.status === "ACTIVE") {
    const effectiveUntil = subscription.current_period_ends_at;
    const eligible = effectiveUntil === null || effectiveUntil > input.at;
    return {
      eligible,
      state: subscription.status,
      effectiveUntil,
      reason: eligible ? "ENTITLED" : "STATE_NOT_ENTITLED",
    };
  }

  if (subscription.status === "PAST_DUE") {
    // PayMongo owns the retry window. Entitlement remains until a verified
    // provider observation changes the state to UNPAID or CANCELED.
    return { eligible: true, state: subscription.status, effectiveUntil: null, reason: "ENTITLED" };
  }

  return {
    eligible: false,
    state: subscription.status,
    effectiveUntil: null,
    reason: "STATE_NOT_ENTITLED",
  };
}
