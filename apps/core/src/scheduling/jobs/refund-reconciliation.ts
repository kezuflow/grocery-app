import { reconcileRefunds } from "../../payments/application/reconcile-refunds";
import type { ScheduledJob } from "../types";

export const refundReconciliationJob: ScheduledJob = {
  name: "payments.refund-reconciliation",
  async run({ database, registry, now }) {
    const result = await reconcileRefunds(database, registry, now);
    return {
      status: "SUCCEEDED",
      affected: result.attempted,
      detail: `considered=${result.considered} unresolved=${result.unresolved}`,
    };
  },
};
