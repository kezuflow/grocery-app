import { expireProviderActions } from "../../payments/application/expire-provider-actions";
import type { ScheduledJob } from "../types";

export const providerActionExpiryJob: ScheduledJob = {
  name: "payments.provider-action-expiry",
  async run(context) {
    const affected = await expireProviderActions(context.database, context.now);
    return { status: affected > 0 ? "SUCCEEDED" : "SKIPPED", affected };
  },
};
