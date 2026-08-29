import { redriveProviderInbox } from "../../payments/application/redrive-provider-inbox";
import type { ScheduledJob } from "../types";

export const providerInboxRedriveJob: ScheduledJob = {
  name: "payments.provider-inbox-redrive",
  async run(context) {
    const outcome = await redriveProviderInbox(context.database, { now: context.now });
    const affected = outcome.applied + outcome.escalated;
    return {
      status: affected > 0 ? "SUCCEEDED" : "SKIPPED",
      affected,
      errorCode: outcome.retryRequired > 0 ? "PROVIDER_INBOX_RETRY_REMAINING" : undefined,
      detail:
        outcome.inspected > 0
          ? `${outcome.claimed} claimed, ${outcome.applied} applied, ${outcome.retryRequired} retryable, ${outcome.escalated} escalated`
          : undefined,
    };
  },
};
