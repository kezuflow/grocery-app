import { bookAutomaticInstantDeliveries } from "../../delivery/application/book-automatic-instant-deliveries";
import type { ScheduledJob } from "../types";

export const instantDeliveryBookingJob: ScheduledJob = {
  name: "delivery.instant-booking",
  async run({ database, deliveryProviders, now }) {
    if (!deliveryProviders) return { status: "SKIPPED" };
    const result = await bookAutomaticInstantDeliveries(database, deliveryProviders, now);
    return {
      status: result.deferred ? "FAILED" : "SUCCEEDED",
      affected: result.submitted,
      ...(result.deferred ? { errorCode: "INSTANT_BOOKING_DEFERRED" } : {}),
    };
  },
};
