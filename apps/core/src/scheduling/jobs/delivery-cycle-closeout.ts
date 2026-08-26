import { closeCompletedDeliveryCycles } from "../../commerce/application/close-completed-delivery-cycles";
import type { ScheduledJob } from "../types";

/** Closes completed cutoff-reached cycles once their window has passed. */
export const deliveryCycleCloseoutJob: ScheduledJob = {
  name: "commerce.cycle-closeout",
  async run({ database, now }) {
    const summary = await closeCompletedDeliveryCycles(database, now);
    return {
      status: "SUCCEEDED",
      affected: summary.closed,
      detail: `${summary.closed} of ${summary.considered} eligible cycle(s) closed`,
    };
  },
};
