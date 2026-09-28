import { expireOrderMessages } from "../../messages/application/expire-order-messages";
import type { ScheduledJob } from "../types";

export const orderMessageRetentionJob: ScheduledJob = {
  name: "messaging.retention",
  async run({ database, productMedia, now }) {
    const affected = await expireOrderMessages(database, productMedia, now);
    return { status: "SUCCEEDED", affected };
  },
};
