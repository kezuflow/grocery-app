import { reconcileProviderObservations } from "../../delivery/application/reconcile-provider-observations";
import type { ScheduledJob } from "../types";

export const deliveryObservationRedriveJob: ScheduledJob = {
  name: "delivery.observation-redrive",
  async run({ database, now }) {
    const result = await reconcileProviderObservations(database, now);
    return {
      status: "SUCCEEDED",
      affected: result.applied,
      detail: `attempted=${result.attempted} applied=${result.applied} deferred=${result.deferred}`,
    };
  },
};
