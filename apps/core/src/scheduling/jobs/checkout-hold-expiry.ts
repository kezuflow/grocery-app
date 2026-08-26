import { expireCheckoutAttempts } from "../../commerce/reconciliation";
import type { ScheduledJob } from "../types";

/** Releases reservations owned by expired checkout attempts. */
export const checkoutHoldExpiryJob: ScheduledJob = {
  name: "checkout.hold-expiry",
  async run({ database, now }) {
    const expired = await expireCheckoutAttempts(database, now);
    return {
      status: "SUCCEEDED",
      affected: expired,
      detail: `${expired} expired checkout attempt(s) released`,
    };
  },
};
