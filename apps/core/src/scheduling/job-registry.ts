import type { ScheduledJob } from "./types";
import { checkoutHoldExpiryJob } from "./jobs/checkout-hold-expiry";
import { membershipScheduledCancellationsJob } from "./jobs/membership-scheduled-cancellations";

const EVERY_MINUTE = "* * * * *";
const EVERY_FIFTEEN_MINUTES = "*/15 * * * *";

// Per-cron job registrations. Every key must appear verbatim in the
// `triggers.crons` array of apps/core/wrangler.jsonc. Later programs extend
// this map with their own modules; nothing else may dispatch scheduled work.
const REGISTRY: Readonly<Record<string, readonly ScheduledJob[]>> = {
  [EVERY_MINUTE]: [checkoutHoldExpiryJob, membershipScheduledCancellationsJob],
  [EVERY_FIFTEEN_MINUTES]: [checkoutHoldExpiryJob, membershipScheduledCancellationsJob],
};

export function getJobsForCron(cronExpression: string): readonly ScheduledJob[] {
  return REGISTRY[cronExpression] ?? [];
}

export const SCHEDULED_CRON_EXPRESSIONS: readonly string[] = Object.keys(REGISTRY);
