import { reachDueCycleCutoff } from "../../commerce/application/reach-due-cycle-cutoff";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
import type { ScheduledJob } from "../types";

/** Claims the OPEN -> CUTOFF_REACHED transition for every due delivery cycle. */
export const deliveryCycleCutoffJob: ScheduledJob = {
  name: "commerce.cycle-cutoff",
  async run({ database, now }) {
    const opened = await openDueDeliveryCycles(database, now);
    const reached = await reachDueCycleCutoff(database, now);
    return {
      status: "SUCCEEDED",
      affected: opened + reached,
      detail: `${opened} cycle(s) opened; ${reached} reached cutoff`,
    };
  },
};
