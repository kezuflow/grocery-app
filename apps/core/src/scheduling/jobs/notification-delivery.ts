import { deliverNotifications } from "../../notifications/application/deliver-notifications";
import { projectDomainNotifications } from "../../notifications/application/project-domain-notifications";
import type { ScheduledJob } from "../types";

export const notificationDeliveryJob: ScheduledJob = {
  name: "notifications.delivery",
  async run({ database, emailDelivery, now }) {
    const projected = await projectDomainNotifications(database, now);
    const delivery = await deliverNotifications(database, emailDelivery, now);
    return {
      status: "SUCCEEDED",
      affected: projected + delivery.delivered,
      detail: `${projected} projected, ${delivery.attempted} attempted, ${delivery.delivered} delivered`,
    };
  },
};
