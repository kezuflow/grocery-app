import { lookupProviderDeliveries } from "../../delivery/application/lookup-provider-deliveries";
import type { ScheduledJob } from "../types";

export const deliveryProviderLookupJob: ScheduledJob = {
  name: "delivery.provider-lookup",
  async run({ database, deliveryProviders, now }) {
    if (!deliveryProviders) return { status: "SKIPPED" };
    const result = await lookupProviderDeliveries(database, deliveryProviders(), now);
    return {
      status: "SUCCEEDED",
      affected: result.applied,
      detail: `attempted=${result.attempted} applied=${result.applied}`,
    };
  },
};
