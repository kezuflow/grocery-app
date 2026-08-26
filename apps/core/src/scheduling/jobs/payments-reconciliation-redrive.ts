import { reconcileStuckPayments } from "../../payments/application/reconcile-stuck-payments";
import type { ScheduledJob } from "../types";

/** Reconciles payments stranded in pre-commitment states past the threshold. */
export const paymentsReconciliationRedriveJob: ScheduledJob = {
  name: "payments.reconciliation-redrive",
  async run({ database, registry, now }) {
    const summary = await reconcileStuckPayments(database, registry, now);
    return {
      status: "SUCCEEDED",
      affected: summary.attempted,
      detail: `considered=${summary.considered} providerLookups=${summary.attempted}`,
    };
  },
};
