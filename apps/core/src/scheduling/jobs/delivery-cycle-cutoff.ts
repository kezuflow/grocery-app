import { reachDueCycleCutoff } from "../../commerce/application/reach-due-cycle-cutoff";
import type { ScheduledJob } from "../types";

/** Claims the OPEN -> CUTOFF_REACHED transition for every due delivery cycle. */
export const deliveryCycleCutoffJob: ScheduledJob = {
  name: "commerce.cycle-cutoff",
  async run({ database, now }) {
    const reached = await reachDueCycleCutoff(database, now);
    return {
      status: "SUCCEEDED",
      affected: reached,
      detail: `${reached} cycle(s) reached cutoff`,
    };
  },
};
