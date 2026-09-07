import { resumeDueCancellationRefunds } from "../../orders/application/resume-cancellation-refunds";
import { requestRefund } from "../../payments/application/request-refund";
import type { ScheduledJob } from "../types";

/** Bounded recovery of accepted cancellation intents; no new customer decision. */
export const orderCancellationRefundsJob: ScheduledJob = {
  name: "orders.cancellation-refunds",
  async run({ database, registry, now }) {
    const summary = await resumeDueCancellationRefunds(
      database,
      async (input) => {
        const result = await requestRefund(database, registry, {
          ...input,
          actorId: "system:cancellation-recovery",
          requestId: crypto.randomUUID(),
        });
        return result.ok
          ? { ok: true, refundId: result.value.refundId, refundState: result.value.state }
          : { ok: false };
      },
      now,
    );
    return {
      status: "SUCCEEDED",
      affected: summary.attempted,
      detail: `considered=${summary.considered} submissions=${summary.attempted}`,
    };
  },
};
