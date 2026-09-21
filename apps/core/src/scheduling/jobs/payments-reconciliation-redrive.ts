import { reconcileStuckPayments } from "../../payments/application/reconcile-stuck-payments";
import { completeResolvedReconciliationCases } from "../../payments/application/complete-reconciliation-cases";
import type { ScheduledJob } from "../types";

/** Reconciles payments stranded in pre-commitment states past the threshold. */
export const paymentsReconciliationRedriveJob: ScheduledJob = {
  name: "payments.reconciliation-redrive",
  async run({ database, registry, now }) {
    const summary = await reconcileStuckPayments(database, registry, now);
    const completion = await completeResolvedReconciliationCases(database, now);
    return {
      status: "SUCCEEDED",
      affected: summary.attempted + completion.completed,
      detail: `considered=${summary.considered} providerLookups=${summary.attempted} casesCompleted=${completion.completed}`,
    };
  },
};
