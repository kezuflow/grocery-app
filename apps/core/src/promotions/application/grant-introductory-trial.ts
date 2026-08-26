import { INTRO_TRIAL_BENEFIT_CODE, INTRO_TRIAL_GRANT_ID } from "../domain/introductory-trial";

export type RedemptionClaim = {
  id: string;
  grantId: string;
};

/**
 * Claim the customer's one introductory-trial redemption. The insert is
 * guarded by the partial unique index on (benefit_code, customer) for
 * INTRO_TRIAL rows, so exactly one claim per customer can ever succeed.
 * Must run inside the same D1 batch as the subscription creation.
 */
export function claimIntroductoryTrialRedemption(
  database: D1Database,
  input: {
    redemptionId: string;
    customerId: string;
    subjectType: string;
    subjectId: string | null;
    now: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, subject_type, subject_id, redeemed_at) VALUES (?, ?, ?, 'MEMBERSHIP_FEE_WAIVER', ?, ?, ?, ?)",
    )
    .bind(
      input.redemptionId,
      INTRO_TRIAL_GRANT_ID,
      INTRO_TRIAL_BENEFIT_CODE,
      input.customerId,
      input.subjectType,
      input.subjectId,
      input.now,
    );
}

export async function hasIntroductoryRedemption(
  database: D1Database,
  customerId: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      "SELECT COUNT(*) AS count FROM promotion_redemption WHERE benefit_code=? AND customer_id=?",
    )
    .bind(INTRO_TRIAL_BENEFIT_CODE, customerId)
    .first<{ count: number }>();
  return (row?.count ?? 0) > 0;
}
