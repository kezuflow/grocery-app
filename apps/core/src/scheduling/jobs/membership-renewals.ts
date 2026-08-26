import { processMembershipRenewals } from "../../membership/application/process-membership-renewals";
import type { ScheduledJob, ScheduledJobOutcome } from "../types";

/**
 * Program 3 renewal/dunning sweep: initiate due renewal charges (single
 * attempt per period; retries stay with the provider), apply provider-
 * confirmed failure outcomes, and expire exhausted grace windows.
 */
export const membershipRenewalsJob: ScheduledJob = {
  name: "membership-renewals",
  async run(context): Promise<ScheduledJobOutcome> {
    const outcome = await processMembershipRenewals(
      context.database,
      context.registry,
      context.now,
    );
    const affected = outcome.initiated + outcome.failureOutcomesApplied + outcome.graceExpired;
    if (outcome.initiationFailures > 0) {
      return {
        status: "FAILED",
        affected,
        errorCode: "RENEWAL_INITIATION_FAILED",
        detail: `${outcome.initiated} initiated, ${outcome.initiationFailures} initiation failures, ${outcome.failureOutcomesApplied} failure outcomes applied, ${outcome.graceExpired} grace expiries`,
      };
    }
    return {
      status: "SUCCEEDED",
      affected,
      detail:
        outcome.initiated + outcome.failureOutcomesApplied + outcome.graceExpired > 0
          ? `${outcome.initiated} initiated, ${outcome.failureOutcomesApplied} failure outcomes applied, ${outcome.graceExpired} grace expiries`
          : undefined,
    };
  },
};
