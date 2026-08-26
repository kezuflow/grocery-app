import { applyScheduledCancellations } from "../../membership/application/apply-scheduled-cancellations";
import type { ScheduledJob } from "../types";

const BATCH_LIMIT = 50;

/** Applies due period-end membership cancellations at their effective instant. */
export const membershipScheduledCancellationsJob: ScheduledJob = {
  name: "membership.scheduled-cancellations",
  async run({ database, now }) {
    const outcomes = await applyScheduledCancellations(database, now, BATCH_LIMIT);
    const applied = outcomes.filter((outcome) => outcome.applied).length;
    return {
      status: "SUCCEEDED",
      affected: applied,
      detail: `${applied} scheduled cancellation(s) applied`,
    };
  },
};
