import { processMembershipRenewals } from "../../membership/application/process-membership-renewals";
import type { ScheduledJob, ScheduledJobOutcome } from "../types";

/**
 * Program 3 membership time sweep: expire ended free trials, initiate due paid
 * renewal charges (single attempt per period; retries stay with the provider),
 * apply provider-confirmed failure outcomes, and expire exhausted grace windows.
 */
export const membershipRenewalsJob: ScheduledJob = {
  name: "membership-renewals",
  async run(context): Promise<ScheduledJobOutcome> {
    const outcome = await processMembershipRenewals(
      context.database,
      context.registry,
      context.now,
      { initiationEnabled: context.renewalInitiationEnabled },
    );
    const affected =
      outcome.trialsExpired +
      outcome.initiated +
      outcome.failureOutcomesApplied +
      outcome.graceExpired;
    if (outcome.initiationFailures > 0) {
      return {
        status: "FAILED",
        affected,
        errorCode: "RENEWAL_INITIATION_FAILED",
        detail: `${outcome.trialsExpired} trials expired, ${outcome.initiated} initiated, ${outcome.initiationFailures} initiation failures, ${outcome.failureOutcomesApplied} failure outcomes applied, ${outcome.graceExpired} grace expiries`,
      };
    }
    if (outcome.initiationSkipped && affected === 0)
      return {
        status: "SKIPPED",
        affected: 0,
        errorCode: "RENEWAL_INITIATION_DISABLED",
        detail: "Renewal initiation ownership is disabled; reconciliation found no due effects",
      };
    return {
      status: "SUCCEEDED",
      affected,
      detail:
        affected > 0
          ? `${outcome.trialsExpired} trials expired, ${outcome.initiated} initiated, ${outcome.failureOutcomesApplied} failure outcomes applied, ${outcome.graceExpired} grace expiries`
          : undefined,
    };
  },
};
