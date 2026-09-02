import { processMembershipRenewals } from "../../membership/application/process-membership-renewals";
import type { ScheduledJob, ScheduledJobOutcome } from "../types";

/**
 * Membership-owned time sweep. Paid billing and dunning are provider-owned;
 * this job only expires no-payment introductory trials.
 */
export const membershipRenewalsJob: ScheduledJob = {
  name: "membership-trial-expiry",
  async run(context): Promise<ScheduledJobOutcome> {
    const outcome = await processMembershipRenewals(context.database, context.now);
    const affected = outcome.trialsExpired;
    return {
      status: "SUCCEEDED",
      affected,
      detail: affected > 0 ? `${outcome.trialsExpired} introductory trials expired` : undefined,
    };
  },
};
