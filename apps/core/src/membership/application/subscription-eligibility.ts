import type { SubscriptionEligibilityRequest, SubscriptionState } from "@freshmarkets/contracts";
import { evaluateSubscriptionEntitlement } from "./evaluate-subscription-entitlement";

export type SubscriptionEligibility = {
  eligible: boolean;
  state: SubscriptionState | null;
  trialEndsAt: string | null;
};

/**
 * Latest-subscription checkout eligibility. Only entitled states with valid
 * effective timestamps are eligible: TRIALING before its exact trial-end,
 * ACTIVE during its paid period, and PAST_DUE inside its 7-calendar-day grace
 * window. Historical trial timestamps never shorten a converted ACTIVE period.
 */
export async function getSubscriptionEligibility(
  database: D1Database,
  query: { customerId: string } & SubscriptionEligibilityRequest,
): Promise<{ ok: true; value: SubscriptionEligibility; requestId: string }> {
  const decision = await evaluateSubscriptionEntitlement(database, {
    customerId: query.customerId,
    at: Date.now(),
  });
  return {
    ok: true as const,
    value: {
      eligible: decision.eligible,
      state: decision.state as SubscriptionState | null,
      trialEndsAt:
        decision.state === "TRIALING" && decision.effectiveUntil !== null
          ? new Date(decision.effectiveUntil).toISOString()
          : null,
    },
    requestId: query.requestId,
  };
}
