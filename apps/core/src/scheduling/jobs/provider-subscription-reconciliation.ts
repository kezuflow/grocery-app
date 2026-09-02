import { reconcileProviderSubscriptions } from "../../payments/application/reconcile-provider-subscriptions";
import type { ScheduledJob } from "../types";

export const providerSubscriptionReconciliationJob: ScheduledJob = {
  name: "payments.provider-subscription-reconciliation",
  async run({ database, registry, now }) {
    const result = await reconcileProviderSubscriptions(database, registry, now);
    return {
      status: result.failed > 0 ? "FAILED" : "SUCCEEDED",
      affected: result.applied,
      ...(result.failed > 0 ? { errorCode: "PROVIDER_SUBSCRIPTION_RECONCILIATION_FAILED" } : {}),
      detail: `${result.applied} applied, ${result.unchanged} unchanged, ${result.failed} failed`,
    };
  },
};
