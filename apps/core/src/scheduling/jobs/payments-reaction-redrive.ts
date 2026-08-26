import { redrivePaymentReactions } from "../../payments/application/redrive-payment-reactions";
import type { ScheduledJob } from "../types";

/** Retries pending Payments reactions and escalates exhausted ones. */
export const paymentsReactionRedriveJob: ScheduledJob = {
  name: "payments.reaction-redrive",
  async run({ database, registry, now }) {
    const summary = await redrivePaymentReactions(database, registry, now);
    return {
      status: "SUCCEEDED",
      affected: summary.applied + summary.escalated,
      detail: `applied=${summary.applied} retried=${summary.retried} reconciled=${summary.reconciled} escalated=${summary.escalated}`,
    };
  },
};
