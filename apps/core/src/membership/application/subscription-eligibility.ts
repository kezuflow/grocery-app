import type { SubscriptionEligibilityRequest, SubscriptionState } from "@freshmarkets/contracts";

export type SubscriptionEligibility = {
  eligible: boolean;
  state: SubscriptionState | null;
  trialEndsAt: string | null;
};

/**
 * Latest-subscription checkout eligibility. Only entitled states with valid
 * effective timestamps are eligible: TRIALING/ACTIVE before an exact trial-end
 * boundary, and PAST_DUE inside its 7-calendar-day grace window. The exact
 * instant checks guard rows that have not yet transitioned.
 */
export async function getSubscriptionEligibility(
  database: D1Database,
  query: { customerId: string } & SubscriptionEligibilityRequest,
): Promise<{ ok: true; value: SubscriptionEligibility; requestId: string }> {
  const now = Date.now();
  const row = await database
    .prepare(
      "SELECT status, trial_ends_at, grace_ends_at FROM subscription WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(query.customerId)
    .first<{ status: string; trial_ends_at: number | null; grace_ends_at: number | null }>();
  const eligible = Boolean(
    row &&
    ((["ACTIVE", "TRIALING"].includes(row.status) &&
      (!row.trial_ends_at || row.trial_ends_at > now)) ||
      (row.status === "PAST_DUE" && row.grace_ends_at !== null && row.grace_ends_at > now)),
  );
  return {
    ok: true as const,
    value: {
      eligible,
      state: (row?.status ?? null) as SubscriptionState | null,
      trialEndsAt: row?.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    },
    requestId: query.requestId,
  };
}
