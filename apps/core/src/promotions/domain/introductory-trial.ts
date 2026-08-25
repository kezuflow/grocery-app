export const INTRO_TRIAL_BENEFIT_CODE = "INTRO_TRIAL" as const;
export const INTRO_TRIAL_GRANT_ID = "grant-introductory-trial" as const;

export type IntroductoryTrialEligibility =
  | { eligible: true }
  | { eligible: false; reason: "REDEMPTION_EXISTS" };

/**
 * Promotions-owned introductory-trial authority: a customer is eligible only
 * while no `INTRO_TRIAL` redemption exists for them. The uniqueness is
 * enforced by the partial unique index on promotion_redemption, so concurrent
 * attempts cannot both consume the grant.
 */
export function introductoryTrialEligibility(
  existingRedemptions: number,
): IntroductoryTrialEligibility {
  return existingRedemptions > 0
    ? { eligible: false, reason: "REDEMPTION_EXISTS" }
    : { eligible: true };
}
